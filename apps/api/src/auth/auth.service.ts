import { AsyncLocalStorage } from "node:async_hooks";
import * as Sentry from "@sentry/nestjs";
import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization, magicLink, twoFactor } from "better-auth/plugins";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { BillingService } from "../billing/billing.service";
import { DEFAULT_STATUSES, DEFAULT_BRANDING } from "@atrium/shared";
import { render } from "@react-email/render";
import { InvitationEmail, MagicLinkEmail, ResetPasswordEmail, VerifyEmail } from "@atrium/email";

interface AdminResetContext {
  capturedUrl: string | null;
  emailSent: boolean;
  emailViaOrgConfig: boolean;
}

@Injectable()
export class AuthService {
  public auth: ReturnType<typeof betterAuth>;
  private readonly logger = new Logger(AuthService.name);
  private readonly adminResetStorage = new AsyncLocalStorage<AdminResetContext>();

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
      // API_URL is the canonical var; BETTER_AUTH_URL is kept as a fallback for
      // existing deployments that set it before the rename in v1.4.
      baseURL:
        this.config.get("API_URL") ??
        this.config.get("BETTER_AUTH_URL") ??
        "http://localhost:3001",
      basePath: "/api/auth",
      session: {
        expiresIn: 60 * 60 * 24 * 30,   // 30 days
        updateAge: 60 * 60 * 24,         // refresh if older than 1 day
      },
      trustedOrigins: [
        webUrl,
        this.config.get("API_URL") ??
          this.config.get("BETTER_AUTH_URL") ??
          "http://localhost:3001",
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
        // Revoke all existing sessions when a password is reset so a stolen or
        // forgotten session can't be used after the user (or an admin) recovers
        // the account.
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: async ({ user, url }) => {
          const ctx = this.adminResetStorage.getStore();
          if (ctx) {
            ctx.capturedUrl = url;
          }
          const html = await render(ResetPasswordEmail({ url }));
          const organizationId = await this.getPrimaryOrgForUserId(user.id);
          const result = await this.mail.send(
            user.email,
            "Reset your password",
            html,
            organizationId,
          );
          if (ctx) {
            ctx.emailSent = result.sent;
            ctx.emailViaOrgConfig = result.viaOrgConfig;
          }
        },
      },
      emailVerification: {
        sendOnSignUp: true,
        autoSignInAfterVerification: true,
        sendVerificationEmail: async ({ user, url }) => {
          const html = await render(VerifyEmail({ url }));
          const organizationId = await this.getPrimaryOrgForUserId(user.id);
          await this.mail.send(
            user.email,
            "Verify your email address",
            html,
            organizationId,
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
              organization.id,
            );
          },
          organizationHooks: {
            afterCreateOrganization: async ({ organization }) => {
              await this.seedOrganizationDefaults(organization.id);
              try {
                await this.billingService.initializeFreePlan(organization.id);
              } catch (err) {
                Sentry.captureException(err);
                this.logger.error("Failed to initialize free plan", err);
              }
            },
          },
        }),
        magicLink({
          sendMagicLink: async ({ email, url }) => {
            const html = await render(MagicLinkEmail({ url }));
            const organizationId = await this.getPrimaryOrgForEmail(email);
            await this.mail.send(
              email,
              "Sign in to Atrium",
              html,
              organizationId,
            );
          },
        }),
        twoFactor({
          issuer: "Atrium",
          totpOptions: {
            digits: 6,
            period: 30,
          },
          backupCodeOptions: {
            amount: 10,
            length: 10,
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

  // Picks the most recently created membership when the user belongs to
  // multiple orgs — used to route auth emails through per-org email config.
  async getPrimaryOrgForUserId(userId: string): Promise<string | undefined> {
    try {
      const member = await this.prisma.member.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { organizationId: true },
      });
      return member?.organizationId;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Failed to resolve primary org for user",
      );
      return undefined;
    }
  }

  async getPrimaryOrgForEmail(email: string): Promise<string | undefined> {
    try {
      const member = await this.prisma.member.findFirst({
        where: { user: { email } },
        orderBy: { createdAt: "desc" },
        select: { organizationId: true },
      });
      return member?.organizationId;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Failed to resolve primary org for email",
      );
      return undefined;
    }
  }

  async generateResetLink(
    email: string,
  ): Promise<{ url: string; emailSent: boolean; emailViaOrgConfig: boolean }> {
    const webUrl = this.config.get("WEB_URL", "http://localhost:3000");
    const ctx: AdminResetContext = {
      capturedUrl: null,
      emailSent: false,
      emailViaOrgConfig: false,
    };
    await this.adminResetStorage.run(ctx, async () => {
      await this.auth.api.requestPasswordReset({
        body: {
          email,
          redirectTo: `${webUrl}/reset-password`,
        },
      });
    });
    if (!ctx.capturedUrl) {
      throw new InternalServerErrorException("Reset URL was not captured");
    }
    return {
      url: ctx.capturedUrl,
      emailSent: ctx.emailSent,
      emailViaOrgConfig: ctx.emailViaOrgConfig,
    };
  }
}
