import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization, magicLink } from "better-auth/plugins";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { BillingService } from "../billing/billing.service";
import { DEFAULT_STATUSES, DEFAULT_BRANDING } from "@atrium/shared";
import { render } from "@react-email/render";
import { InvitationEmail, MagicLinkEmail, ResetPasswordEmail, VerifyEmail } from "@atrium/email";

@Injectable()
export class AuthService {
  public auth: ReturnType<typeof betterAuth>;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private mail: MailService,
    private billingService: BillingService,
  ) {
    const webUrl = this.config.get("WEB_URL", "http://localhost:3000");

    // Determine cookie security: explicit SECURE_COOKIES env var takes
    // precedence, otherwise default to secure in production.
    const secureCookiesEnv = this.config.get("SECURE_COOKIES");
    const secureCookies =
      secureCookiesEnv !== undefined
        ? secureCookiesEnv === "true"
        : process.env.NODE_ENV === "production";

    this.auth = betterAuth({
      database: prismaAdapter(this.prisma, { provider: "postgresql" }),
      secret: this.config.getOrThrow("BETTER_AUTH_SECRET"),
      baseURL: this.config.get("BETTER_AUTH_URL", "http://localhost:3001"),
      basePath: "/api/auth",
      trustedOrigins: [
        webUrl,
        this.config.get("BETTER_AUTH_URL", "http://localhost:3001"),
      ],
      // Firebase Hosting strips all cookies except "__session".
      // When FIREBASE_HOSTING=true, override the cookie name.
      // On other hosts (Coolify, VPS, etc.) use Better Auth defaults.
      ...(this.config.get("FIREBASE_HOSTING") === "true"
        ? {
            advanced: {
              useSecureCookies: false,
              cookies: {
                session_token: {
                  name: "__session",
                  attributes: {
                    secure: true,
                    httpOnly: true,
                    sameSite: "lax" as const,
                    path: "/",
                  },
                },
              },
            },
          }
        : {
            advanced: {
              useSecureCookies: secureCookies,
            },
          }),
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        maxPasswordLength: 128,
        sendResetPassword: async ({ user, url }) => {
          const html = await render(ResetPasswordEmail({ url }));
          await this.mail.send(
            user.email,
            "Reset your password",
            html,
          );
        },
      },
      emailVerification: {
        sendOnSignUp: true,
        autoSignInAfterVerification: true,
        callbackURL: `${webUrl}/verify-email?verified=true`,
        sendVerificationEmail: async ({ user, url }) => {
          const html = await render(VerifyEmail({ url }));
          await this.mail.send(
            user.email,
            "Verify your email address",
            html,
          );
        },
      },
      plugins: [
        organization({
          sendInvitationEmail: async ({ invitation, inviter, organization }) => {
            const inviteUrl = `${webUrl}/accept-invite?id=${invitation.id}`;
            const html = await render(
              InvitationEmail({
                inviteUrl,
                organizationName: organization.name,
                inviterName: inviter.user.name,
              }),
            );
            await this.mail.send(
              invitation.email,
              `You've been invited to ${organization.name}`,
              html,
            );
          },
          organizationHooks: {
            afterCreateOrganization: async ({ organization }) => {
              await this.seedOrganizationDefaults(organization.id);
              try {
                await this.billingService.initializeFreePlan(organization.id);
              } catch (err) {
                this.logger.error("Failed to initialize free plan", err);
              }
            },
          },
        }),
        magicLink({
          sendMagicLink: async ({ email, url }) => {
            const html = await render(MagicLinkEmail({ url }));
            await this.mail.send(email, "Sign in to Atrium", html);
          },
        }),
      ],
    });
  }

  /**
   * Seeds default project statuses and branding for a new organization.
   * Called after organization creation.
   */
  async seedOrganizationDefaults(organizationId: string) {
    await this.prisma.$transaction(async (tx) => {
      for (const status of DEFAULT_STATUSES) {
        await tx.projectStatus.create({
          data: {
            name: status.name,
            slug: status.slug,
            order: status.order,
            color: status.color,
            organizationId,
          },
        });
      }
      await tx.branding.create({
        data: {
          organizationId,
          primaryColor: DEFAULT_BRANDING.primaryColor,
          accentColor: DEFAULT_BRANDING.accentColor,
        },
      });
      await tx.systemSettings.create({
        data: { organizationId },
      });
    });
  }

  async handleRequest(request: Request) {
    return this.auth.handler(request);
  }
}
