import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nestjs";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization, magicLink, twoFactor } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { passkey } from "@better-auth/passkey";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { seedDefaultPipelines } from "../projects/pursuit-stages.service";
import { PrismaService } from "../prisma/prisma.service";
import { isAllowedRedirectUri } from "./oauth-redirect";
import { applyConsentOutcome } from "../mcp-auth/consent-hooks";
import { revokeCredentialsIfDemoted } from "../common/helpers/member-credentials";
import { ProjectsService } from "../projects/projects.service";
import { ContactSyncService } from "../contact-sync/contact-sync.service";
import { MailService } from "../mail/mail.service";
import { BillingService } from "../billing/billing.service";
import {
  DEFAULT_STATUSES,
  DEFAULT_BRANDING,
  DEFAULT_LEAD_SOURCES,
} from "@atrium/shared";
import { render } from "@react-email/render";
import { InvitationEmail, MagicLinkEmail, ResetPasswordEmail, VerifyEmail } from "@atrium/email";
import {
  formatInvitationExpiry,
  INVITATION_EXPIRES_IN_SECONDS,
  isPortalInviteRole,
  logsInviteLinks,
} from "../clients/invitations";
import { cookieUrlWarning, secureCookies } from "../common/helpers/secure-cookies";
import { publicApiUrl } from "../common/helpers/public-api-url";
import { hashOAuthToken, mcpOAuthUnavailableReason, mcpResourceUrl } from "../common/helpers/mcp-oauth";
import { isPrivilegedRole } from "../common/helpers/privileged-role";
import { passkeyRelyingParty, passkeyUnavailableReason } from "../common/helpers/passkeys";
import { SendLimiter } from "./send-limiter";
import { SessionCache } from "./session-cache";
import { stampFor } from "../two-factor/second-factor";
import { TWO_FACTOR_BEFORE_PATHS, twoFactorAfterHook, twoFactorBeforeHook } from "../two-factor/two-factor-hooks";
import { verifyOwnCode } from "../two-factor/verify-own-code";
import type { CodeApi } from "../two-factor/verify-own-code";
import { isStaffInRequiringWorkspace } from "../two-factor/staff-requirement";
import { countRecoveryCodes } from "../two-factor/recovery-codes";
import { sendSecurityAlert } from "../two-factor/security-alerts";
import type { SecurityAlert } from "../two-factor/security-alerts";
import { EmailRenderer } from "../mail/email-renderer";
import type { AuthHookContext, TwoFactorHookDeps } from "../two-factor/two-factor-hooks";
import type { SecondFactor } from "../two-factor/second-factor";

/** The context Better Auth passes to a before/after hook. */
type AuthHookCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** The parts of Better Auth's endpoint context the session.create hook reads. */
interface SessionCreateContext {
  path?: string;
  context?: { session?: { session?: { secondFactor?: string | null }; user?: { id?: string } } | null };
}

interface AdminResetContext {
  capturedUrl: string | null;
  emailSent: boolean;
  emailViaOrgConfig: boolean;
}

/** Holds the verify URL of a magic link minted for the browser that asked, instead of emailing it. */
interface MagicLinkCapture {
  url: string | null;
}

/** What the accept-invite page shows before anyone is signed in. */
export interface InvitationSummary {
  email: string;
  organizationName: string;
  /** Portal (client) invites sign in by link; staff invites keep the password form. */
  portal: boolean;
}

export type InviteSignInResult = { url: string } | { emailed: true };

/** The magic link plugin's endpoint, which `auth`'s plugin-less type leaves out. */
type SignInMagicLink = (input: {
  body: { email: string; name?: string; callbackURL: string; errorCallbackURL: string };
  headers: Headers;
}) => Promise<unknown>;

/** How long wrong step-up codes are remembered for a session. */
const STEP_UP_FAILURE_TTL_MS: number = 24 * 60 * 60 * 1000;

export const MAGIC_LINK_EXPIRES_IN_SECONDS: number = 60 * 60;

/** The MCP OAuth plugin's `/oauth2/*` endpoints that Atrium serves; the rest answer 404. */
const MCP_OAUTH_PUBLIC_PATHS: ReadonlySet<string> = new Set<string>([
  "/oauth2/register",
  "/oauth2/authorize",
  "/oauth2/token",
  "/oauth2/consent",
  "/oauth2/revoke",
  "/oauth2/introspect",
  "/oauth2/userinfo",
  "/oauth2/end-session",
]);

/** Sign-in emails per address per window, so nobody can flood someone's inbox from the login page. */
const MAGIC_LINK_EMAILS_PER_WINDOW = 3;
const MAGIC_LINK_EMAIL_WINDOW_MS: number = 15 * 60 * 1000;

/** The request's host without a port, lowercased. */
function requestHost(request?: Request): string | null {
  const host: string | null = request?.headers.get("host") ?? null;
  return host ? host.split(":")[0].toLowerCase() : null;
}

@Injectable()
export class AuthService {
  public auth: ReturnType<typeof betterAuth>;
  private readonly logger = new Logger(AuthService.name);
  private readonly adminResetStorage = new AsyncLocalStorage<AdminResetContext>();
  private readonly magicLinkCapture = new AsyncLocalStorage<MagicLinkCapture>();
  private readonly emailRenderer = new EmailRenderer();
  private readonly magicLinkEmails = new SendLimiter(MAGIC_LINK_EMAILS_PER_WINDOW, MAGIC_LINK_EMAIL_WINDOW_MS);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private mail: MailService,
    private billingService: BillingService,
    private contactSync: ContactSyncService,
    private projects: ProjectsService,
    // Defaulted so specs that build the service by hand need not pass one.
    private sessionCache: SessionCache = new SessionCache(),
  ) {
    const webUrl = this.config.get("WEB_URL", "http://localhost:3000");
    const apiUrl: string = publicApiUrl(this.config);
    const betterAuthSecret: string = this.config.getOrThrow("BETTER_AUTH_SECRET");
    // Lets MCP clients sign in instead of pasting an API key. Opt-out only,
    // and off on plain-HTTP installs, where the plugin cannot work.
    const mcpOAuthOff: string | null = mcpOAuthUnavailableReason(this.config);
    const mcpOAuthEnabled: boolean = mcpOAuthOff === null;
    if (mcpOAuthOff && this.config.get("MCP_OAUTH_ENABLED") !== "false") {
      this.logger.warn(`MCP sign-in (OAuth) is off: ${mcpOAuthOff}. MCP clients can still connect with an API key.`);
    }

    // Passkeys need a secure web address; off (with a warning) otherwise.
    const passkeysOff: string | null = passkeyUnavailableReason(this.config);
    if (passkeysOff) this.logger.warn(`Passkeys are off: ${passkeysOff}.`);
    const relyingParty = passkeysOff ? null : passkeyRelyingParty(this.config);

    // Shared with the CSRF guard so both cookies agree. See secure-cookies.ts.
    const useSecure: boolean = secureCookies();
    const cookieWarning: string | null = cookieUrlWarning();
    if (cookieWarning) this.logger.warn(cookieWarning);

    // Hardening applied to the MCP plugin's endpoints before they run.
    const mcpOAuthBeforeHook = async (ctx: AuthHookCtx) => {
      if (ctx.path === "/oauth2/register") {
        // Dynamic registration is anonymous, and the consent page navigates
        // the browser to the registered redirect URI — a `javascript:` or
        // `data:` URI would run script in the Atrium web origin. The body
        // reaches a before-hook unvalidated, hence the shape guards.
        const body: Record<string, unknown> = (ctx.body ?? {}) as Record<string, unknown>;
        const redirectUris: unknown = body.redirect_uris;
        const acceptable: boolean =
          Array.isArray(redirectUris) &&
          redirectUris.length > 0 &&
          redirectUris.every(
            (uri: unknown) =>
              typeof uri === "string" && isAllowedRedirectUri(uri),
          );
        if (!acceptable) {
          throw new APIError("BAD_REQUEST", {
            error: "invalid_redirect_uri",
            error_description:
              "redirect_uris must be a non-empty list of absolute URIs, and may not use the javascript, data, vbscript, blob, file or about schemes.",
          });
        }
        // Tokens are never DPoP-bound (see /oauth2/token below), so register a
        // client asking for that as plain Bearer. Set to false, not removed:
        // hook output is merged with defu, which ignores undefined.
        if (body.dpop_bound_access_tokens === undefined) return;
        return { context: { body: { ...body, dpop_bound_access_tokens: false } } };
      }

      // Endpoints the plugin adds that Atrium does not use. They are
      // session-authenticated client and consent management, outside the
      // registration rate limit and the redirect URI check above.
      if (
        ctx.path.startsWith("/oauth2/") &&
        !MCP_OAUTH_PUBLIC_PATHS.has(ctx.path)
      ) {
        throw new APIError("NOT_FOUND");
      }

      // The MCP endpoint accepts plain bearer tokens only and does not check
      // DPoP proofs, so never bind a token to a DPoP key: without the header
      // the plugin issues an ordinary Bearer token, which RFC 9449 lets the
      // client use as one.
      if (ctx.path === "/oauth2/token") {
        // Hook headers are merged into the request's, so blank it rather than
        // delete it; the plugin treats an empty DPoP header as none.
        if (!ctx.headers?.has("dpop")) return;
        return { context: { headers: new Headers({ dpop: "" }) } };
      }

      if (ctx.path !== "/oauth2/authorize") return;

      // Authorize takes its parameters from the query, or from a form body
      // on POST. Patch whichever one the plugin will read.
      const fromBody: boolean = ctx.method === "POST";
      const params = ((fromBody ? ctx.body : ctx.query) ?? {}) as Record<string, unknown>;

      // Defence in depth for clients registered before the check above.
      const redirectUri: unknown = params.redirect_uri;
      if (
        redirectUri !== undefined &&
        (typeof redirectUri !== "string" || !isAllowedRedirectUri(redirectUri))
      ) {
        throw new APIError("BAD_REQUEST", {
          error: "invalid_request",
          error_description: "redirect_uri is not an acceptable absolute URI.",
        });
      }
      // A dpop_jkt binds the code to a DPoP key, and the token endpoint would
      // then demand a proof Atrium strips. Discovery doesn't advertise DPoP.
      if (params.dpop_jkt !== undefined) {
        throw new APIError("BAD_REQUEST", {
          error: "invalid_request",
          error_description: "DPoP is not supported. Use a plain Bearer token.",
        });
      }

      // Always show the consent page. The plugin skips it once a user has
      // consented to a client, and no real MCP client sends prompt=consent,
      // but the consent page is where the user picks the workspace the
      // client acts in, so it is never optional. Overwritten rather than
      // merged, so a `prompt=none` cannot turn consent into an error.
      // That also drops login/create/select_account: Atrium resumes from its
      // own login page by rebuilding the authorize URL, so a kept
      // prompt=login would send the user back to sign in forever.
      const forced: Record<string, unknown> = { ...params, prompt: "consent" };
      return { context: fromBody ? { body: forced } : { query: forced } };
    };

    // The other half of the two-step consent: /oauth2/consent is where the
    // user's Allow takes effect, so the workspace choice is parked as an
    // McpPendingGrant beforehand and only becomes a grant here, after the
    // endpoint has actually succeeded. See applyConsentOutcome.
    const mcpOAuthAfterHook = async (ctx: AuthHookCtx): Promise<void> => {
      if (ctx.path !== "/oauth2/consent") return;
      // /oauth2/consent runs behind sessionMiddleware, so the signed-in user
      // is on the context by the time an after-hook sees it; `returned` holds
      // the endpoint's APIError when it failed.
      const context = ctx.context as {
        returned?: unknown;
        session?: { user?: { id?: string } };
      };
      await applyConsentOutcome(this.prisma, betterAuthSecret, {
        returned: context.returned,
        body: ctx.body,
        sessionUserId: context.session?.user?.id,
      });
    };

    const twoFactorDeps: TwoFactorHookDeps = {
      prisma: this.prisma,
      forgetSession: (token: string): void => this.sessionCache.delete(token),
      forgetUser: (userId: string): void => this.sessionCache.deleteUser(userId),
      isStaffInRequiringWorkspace: (userId: string): Promise<boolean> =>
        isStaffInRequiringWorkspace(this.prisma, userId),
      sendAlert: (userId: string, alert: SecurityAlert): Promise<void> => this.sendAlert(userId, alert),
      verifyOwnCode: (code: string, headers: Headers): Promise<boolean> =>
        verifyOwnCode(this.auth.api as unknown as CodeApi, code, headers),
      // Feeds an alert email only, so a failure must not fail the sign-in.
      recoveryCodesLeft: async (userId: string): Promise<number> => {
        try {
          return (await countRecoveryCodes(this.prisma, betterAuthSecret, userId)) ?? 0;
        } catch (err) {
          this.logger.error(`Could not count recovery codes: ${err instanceof Error ? err.message : String(err)}`);
          return 0;
        }
      },
      recordStepUpFailure: (sessionId: string): Promise<number> => this.recordStepUpFailure(sessionId),
    };

    // Cast: better-auth >=1.6 makes Auth<Options> invariant, so the concrete
    // instance no longer assigns to the default-typed field.
    this.auth = betterAuth({
      database: prismaAdapter(this.prisma, { provider: "postgresql" }),
      secret: betterAuthSecret,
      baseURL: apiUrl,
      basePath: "/api/auth",
      session: {
        expiresIn: 60 * 60 * 24 * 30,   // 30 days
        updateAge: 60 * 60 * 24,         // refresh if older than 1 day
        // Which second factor this session passed, if any. Stamped by the
        // session.create hook and the two-factor after-hook, never by input.
        // No default, so a replacement session can carry its predecessor's.
        additionalFields: {
          secondFactor: { type: "string", required: false, input: false },
        },
      },
      rateLimit: {
        // Dynamic client registration is unauthenticated by design, so cap it
        // well below the global default.
        customRules: {
          "/oauth2/register": { window: 3600, max: 10 },
        },
      },
      databaseHooks: {
        user: {
          create: {
            // Every route that can mint a user funnels through here: the
            // email/password endpoint /accept-invite posts to directly, the
            // onboarding endpoint, and social sign-in. See maySignUp.
            before: async (user) => {
              if (!(await this.maySignUp(user.email))) {
                throw new APIError("FORBIDDEN", {
                  message:
                    "Signups are disabled on this instance. Ask the workspace owner for an invitation.",
                });
              }
              return { data: user };
            },
          },
        },
        session: {
          create: {
            // Stamp a deterministic active org on every new session. Without
            // this the web app fell back to orgs[0] from an unordered list,
            // so a user who owns one org and is a client of another could
            // land on either, and on a different one each login.
            // Also records which second factor the session passed; see stampFor.
            before: async (session, ctx) => {
              const activeOrganizationId =
                await this.getPreferredActiveOrgForUserId(session.userId);
              const secondFactor: SecondFactor | null = await this.secondFactorForNewSession(
                session.userId,
                ctx as SessionCreateContext | null | undefined,
              );
              return {
                data: {
                  ...session,
                  ...(activeOrganizationId ? { activeOrganizationId } : {}),
                  secondFactor,
                },
              };
            },
          },
        },
      },
      trustedOrigins: (request?: Request) => this.trustedOriginsFor(request),
      hooks: {
        before: createAuthMiddleware(async (ctx: AuthHookCtx) => {
          if (TWO_FACTOR_BEFORE_PATHS.has(ctx.path)) {
            const session = await getSessionFromCtx(ctx);
            const user = session?.user as { id: string; twoFactorEnabled?: boolean | null } | undefined;
            const body = (ctx.body ?? {}) as { code?: unknown };
            await twoFactorBeforeHook(
              {
                path: ctx.path,
                userId: user?.id ?? null,
                twoFactorEnabled: user?.twoFactorEnabled === true,
                code: typeof body.code === "string" ? body.code : undefined,
                headers: ctx.headers ?? new Headers(),
              },
              twoFactorDeps,
            );
          }
          return mcpOAuthEnabled ? mcpOAuthBeforeHook(ctx) : undefined;
        }),
        after: createAuthMiddleware(async (ctx: AuthHookCtx): Promise<void> => {
          await twoFactorAfterHook(ctx as unknown as AuthHookContext, twoFactorDeps);
          if (mcpOAuthEnabled) await mcpOAuthAfterHook(ctx);
        }),
      },
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
              useSecureCookies: useSecure,
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
        onPasswordReset: async ({ user }: { user: { id: string } }): Promise<void> => {
          await this.sendAlert(user.id, { kind: "password_changed" });
        },
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
          allowUserToCreateOrganization: (user: { id: string }) =>
            this.mayCreateOrganization(user.id),
          // Better Auth's default is 48 hours, which a client who reads email
          // on Monday misses for an invite sent on Friday.
          invitationExpiresIn: INVITATION_EXPIRES_IN_SECONDS,
          sendInvitationEmail: async ({ invitation, inviter, organization }) => {
            const inviteUrl = `${webUrl}/accept-invite?id=${invitation.id}`;
            const html = await render(
              InvitationEmail({
                inviteUrl,
                organizationName: organization.name,
                inviterName: inviter.user.name,
                expiresOn: formatInvitationExpiry(new Date(invitation.expiresAt)),
              }),
            );
            let sent: boolean = false;
            try {
              const result = await this.mail.send(
                invitation.email,
                `You've been invited to ${organization.name}`,
                html,
                organization.id,
              );
              sent = result.sent;
            } finally {
              // Lets a local tester accept an invite without a working mail provider.
              if (logsInviteLinks(process.env.NODE_ENV)) {
                this.logger.log(
                  `Invitation for ${invitation.email} ${sent ? "emailed" : "NOT emailed"}; accept at ${inviteUrl}`,
                );
              }
            }
          },
          organizationHooks: {
            // The clients page disables inviting at the limit; this makes the API agree.
            beforeCreateInvitation: async ({ invitation }) => {
              await this.assertInviteWithinPlan(invitation.organizationId, invitation.role);
            },
            // Invites sent during a trial can be accepted after the drop to Free; re-check then.
            // The invite being accepted is still pending and counted, so it is reserved out.
            beforeAcceptInvitation: async ({ invitation }) => {
              await this.assertInviteWithinPlan(invitation.organizationId, invitation.role ?? "member", 1);
            },
            afterCreateInvitation: async ({ invitation }) => {
              try {
                await this.contactSync.recordInvited(invitation.organizationId, invitation.email, invitation.role);
              } catch (err) {
                Sentry.captureException(err);
                this.logger.error("Failed to record invitation on contact", err);
              }
            },
            afterAcceptInvitation: async ({ invitation, user }) => {
              if ((invitation.role ?? "member") !== "member") return;
              try {
                await this.contactSync.ensureForMember(invitation.organizationId, user.id);
              } catch (err) {
                Sentry.captureException(err);
                this.logger.error("Failed to sync contact after invitation accepted", err);
              }
              try {
                // A potential contract won with "Invite to the portal now" promised this client access.
                await this.projects.grantPendingAccess(invitation.organizationId, user.id, user.email);
              } catch (err) {
                Sentry.captureException(err);
                this.logger.error("Failed to grant project access after invitation accepted", err);
              }
            },
            afterCreateOrganization: async ({ organization }) => {
              await this.seedOrganizationDefaults(organization.id);
              try {
                await this.billingService.initializeFreePlan(organization.id, { trial: true });
              } catch (err) {
                Sentry.captureException(err);
                this.logger.error("Failed to initialize free plan", err);
              }
            },
            // Atrium's own role endpoint revokes in the same transaction
            // (ClientsService.changeRole); this covers Better Auth's route.
            afterUpdateMemberRole: async ({ member, previousRole }) => {
              try {
                await revokeCredentialsIfDemoted(this.prisma, member);
              } catch (err) {
                Sentry.captureException(err);
                this.logger.error("Failed to revoke credentials after demotion", err);
              }
              try {
                await this.contactSync.syncRoleChange(
                  member.organizationId,
                  member.userId,
                  previousRole,
                  member.role,
                );
              } catch (err) {
                Sentry.captureException(err);
                this.logger.error("Failed to sync contact after role change", err);
              }
            },
            // Atrium's own remove endpoint detaches itself (ClientsService.removeMember);
            // this covers Better Auth's /organization/remove-member. /organization/leave
            // does not fire this hook in Better Auth 1.4.18.
            afterRemoveMember: async ({ member }) => {
              if (member.role !== "member") return;
              try {
                await this.contactSync.detachMember(member.organizationId, member.userId);
              } catch (err) {
                Sentry.captureException(err);
                this.logger.error("Failed to detach contact after member removal", err);
              }
            },
          },
        }),
        twoFactor({
          issuer: "Atrium",
          twoFactorPage: "/login/2fa",
          // Clients who only sign in by email link have no password to give.
          allowPasswordless: true,
          backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: "encrypted" },
        }),
        // Pinned to the web address: the plugin's defaults would use the API
        // host and trust custom portal domains. User verification is required
        // so a passkey counts as two factors (device plus PIN or biometric).
        ...(relyingParty
          ? [
              passkey({
                rpID: relyingParty.rpID,
                rpName: "Atrium",
                origin: relyingParty.origin,
                authenticatorSelection: { residentKey: "required", userVerification: "required" },
              }),
            ]
          : []),
        magicLink({
          expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
          sendMagicLink: ({ email, url }) => this.deliverMagicLink(email, url),
        }),
        ...(mcpOAuthEnabled
          ? [
              mcp({
                loginPage: `${webUrl}/login`,
                consentPage: `${webUrl}/oauth/consent`,
                resource: mcpResourceUrl(this.config),
                // Opaque access tokens, stored (hashed) in the database, so
                // Disconnect and a workspace change take effect at once.
                disableJwtPlugin: true,
                storeTokens: { hash: hashOAuthToken },
                // MCP clients register themselves (RFC 7591) with no account.
                allowDynamicClientRegistration: true,
                allowUnauthenticatedClientRegistration: true,
                // Native clients (Claude Code, Cursor) register loopback or
                // custom-scheme redirects without saying they are native.
                clientRegistrationDefaultApplicationType: "infer",
                scopes: ["openid", "profile", "email", "offline_access"],
                accessTokenExpiresIn: 3600,
                refreshTokenExpiresIn: 60 * 60 * 24 * 30,
              }),
            ]
          : []),
      ],
    }) as unknown as ReturnType<typeof betterAuth>;
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
        },
      });
      await tx.systemSettings.create({
        data: { organizationId },
      });
      await tx.leadSource.createMany({
        data: DEFAULT_LEAD_SOURCES.map((name) => ({ organizationId, name })),
        skipDuplicates: true,
      });
      await seedDefaultPipelines(tx, organizationId);
    });
  }

  /** Emails a user about a change to their account security. Never throws. */
  sendAlert(userId: string, alert: SecurityAlert): Promise<void> {
    return sendSecurityAlert(
      { prisma: this.prisma, mail: this.mail, renderer: this.emailRenderer, logger: this.logger },
      userId,
      alert,
    );
  }

  /**
   * Counts a wrong step-up code for one session, in the verification table so
   * every API instance shares the count. Expires with the session's challenge.
   */
  private async recordStepUpFailure(sessionId: string): Promise<number> {
    const identifier: string = `two-factor-step-up:${sessionId}`;
    const row = await this.prisma.verification.findFirst({ where: { identifier }, select: { id: true, value: true } });
    const attempts: number = (row ? Number(row.value) || 0 : 0) + 1;
    if (row) {
      await this.prisma.verification.update({ where: { id: row.id }, data: { value: String(attempts) } });
    } else {
      await this.prisma.verification.create({
        data: {
          id: randomUUID(),
          identifier,
          value: String(attempts),
          expiresAt: new Date(Date.now() + STEP_UP_FAILURE_TTL_MS),
        },
      });
    }
    return attempts;
  }

  /** See stampFor. Only a password sign-in needs to know whether the user has TOTP. */
  private async secondFactorForNewSession(
    userId: string,
    ctx: SessionCreateContext | null | undefined,
  ): Promise<SecondFactor | null> {
    const path: string = ctx?.path ?? "";
    const current = ctx?.context?.session;
    const currentSecondFactor: string | null = current?.session?.secondFactor ?? null;
    const sameUser: boolean = current?.user?.id === userId;
    let userHasTotp: boolean = false;
    if (path === "/sign-in/email" || path === "/sign-in/username") {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { twoFactorEnabled: true },
      });
      userHasTotp = user?.twoFactorEnabled === true;
    }
    return stampFor({ path, currentSecondFactor, userHasTotp, sameUser });
  }

  async handleRequest(request: Request) {
    return this.auth.handler(request);
  }

  /**
   * Whether a brand-new account may be created for this email address.
   *
   * `ALLOW_SIGNUPS=false` has never meant "no new users" — `/accept-invite`
   * creates accounts by posting straight to `/api/auth/sign-up/email`, and an
   * operator who closes public signup still needs invited clients to get in.
   * What it means is no *unsolicited* users, so the test is whether someone
   * already asked this address to join.
   *
   * Enforced in the `user.create` database hook rather than at any one
   * endpoint, because the auth proxy is `@All("*path") @Public()` and exposes
   * every Better Auth route, social providers included. Gating a single
   * controller would leave the rest open.
   *
   * Fails closed: if the invitation lookup errors we refuse rather than let an
   * outage turn a locked-down deploy into an open one.
   */
  async maySignUp(email: string): Promise<boolean> {
    if (this.config.get("ALLOW_SIGNUPS") !== "false") return true;

    try {
      const invitation = await this.prisma.invitation.findFirst({
        where: {
          email: { equals: email, mode: "insensitive" },
          status: "pending",
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      return invitation !== null;
    } catch (err) {
      this.logger.warn({ err }, "Invitation lookup failed; refusing signup");
      return false;
    }
  }

  /** Plan gate for invites. Clients count against the clients limit, staff against team members. */
  async assertInviteWithinPlan(organizationId: string, role: string, reserved = 0): Promise<void> {
    try {
      await this.billingService.assertPlanLimit(organizationId, role === "member" ? "clients" : "members", reserved);
    } catch (err) {
      if (err instanceof ForbiddenException) {
        throw new APIError("FORBIDDEN", { message: err.message });
      }
      throw err;
    }
  }

  /**
   * Who is allowed to create an organization.
   *
   * `ALLOW_SIGNUPS=false` locks the deploy down entirely. Otherwise the rule
   * is about role, not mere membership: portal clients are invited with
   * `role: "member"` and so hold a `Member` row just like staff do — the
   * dashboard layout relies on exactly that to send them to /portal. So the
   * question is whether the user runs an organization anywhere.
   *
   * - owner or admin somewhere — allowed; this is the multi-org agency case
   * - a brand-new signup (no rows at all) — allowed, because signup creates
   *   the first org through this same endpoint (see
   *   `OnboardingController.signup`), so denying it would break signup
   * - anyone else — a portal client (`role: "member"` and/or a
   *   `ProjectClient` row) — denied; the auth proxy exposes
   *   `organization/create` to every logged-in user, and a client of an
   *   agency has no business creating organizations on its deploy
   */
  async mayCreateOrganization(userId: string): Promise<boolean> {
    if (this.config.get("ALLOW_SIGNUPS") === "false") return false;

    const memberships = await this.prisma.member.findMany({
      where: { userId },
      select: { role: true },
    });
    if (memberships.some((m) => isPrivilegedRole(m.role))) {
      return true;
    }
    // Only client-role memberships: this is a portal client.
    if (memberships.length > 0) return false;

    const clientOf = await this.prisma.projectClient.count({
      where: { userId },
    });
    return clientOf === 0;
  }

  /**
   * The org a fresh session should start in. Prefer somewhere the user runs
   * things (owner/admin, most recent first) over somewhere they are merely a
   * client, so an agency owner who is also a client elsewhere lands on their
   * dashboard rather than another agency's portal.
   */
  async getPreferredActiveOrgForUserId(
    userId: string,
  ): Promise<string | undefined> {
    try {
      const staff = await this.prisma.member.findFirst({
        where: { userId, role: { in: ["owner", "admin"] } },
        orderBy: { createdAt: "desc" },
        select: { organizationId: true },
      });
      if (staff) return staff.organizationId;

      const any = await this.prisma.member.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { organizationId: true },
      });
      return any?.organizationId;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Failed to resolve preferred active org for user",
      );
      return undefined;
    }
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

  /** A still-usable invitation, or null when it is unknown, expired or already answered. */
  async describeInvitation(id: string): Promise<InvitationSummary | null> {
    const invitation = await this.findOpenInvitation(id);
    if (!invitation) return null;
    return {
      email: invitation.email,
      organizationName: invitation.organization.name,
      portal: isPortalInviteRole(invitation.role),
    };
  }

  private async findOpenInvitation(id: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id },
      include: { organization: { select: { name: true } } },
    });
    if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= new Date()) {
      return null;
    }
    return invitation;
  }

  /**
   * One click on a portal invite. Someone new gets a sign-in URL back to follow
   * straight away — the invite email already proved they own the address, and a
   * second email is exactly the friction this removes. Someone who already has
   * an account is emailed a short-lived link instead: that account may hold
   * another workspace's data, and a two-week invite link shouldn't open it.
   * Either way the link returns to /accept-invite, which joins the workspace.
   */
  async startInviteSignIn(id: string): Promise<InviteSignInResult> {
    const invitation = await this.findOpenInvitation(id);
    if (!invitation) throw new NotFoundException("This invitation has expired or was already used");
    if (!isPortalInviteRole(invitation.role)) throw new BadRequestException("Team invitations are accepted with a password");

    const webUrl: string = this.config.get("WEB_URL", "http://localhost:3000");
    const acceptUrl = `${webUrl}/accept-invite?id=${id}`;
    const body = { email: invitation.email, callbackURL: acceptUrl, errorCallbackURL: acceptUrl };

    const signInMagicLink = (this.auth.api as unknown as { signInMagicLink: SignInMagicLink }).signInMagicLink;
    if (await this.hasAccount(invitation.email)) {
      await signInMagicLink({ body, headers: new Headers() });
      return { emailed: true };
    }

    const name: string = await this.inviteeName(invitation.organizationId, invitation.email);
    const capture: MagicLinkCapture = { url: null };
    await this.magicLinkCapture.run(capture, () =>
      signInMagicLink({ body: { ...body, name }, headers: new Headers() }),
    );
    if (!capture.url) throw new InternalServerErrorException("Sign-in link was not captured");
    return { url: capture.url };
  }

  /**
   * The magic link plugin's sender. A link minted by startInviteSignIn is handed
   * back to that request rather than emailed. Otherwise it goes only to existing
   * accounts, so "email me a sign-in link" on the login page can't create one
   * (the plugin signs up unknown addresses on verify) and answers the same
   * whether or not the address is registered. The emailed link opens a web page
   * with a button: mail scanners fetch every link they see, and fetching the
   * verify endpoint itself would spend the single-use token before the person
   * clicks.
   */
  async deliverMagicLink(email: string, url: string): Promise<void> {
    const capture: MagicLinkCapture | undefined = this.magicLinkCapture.getStore();
    if (capture) {
      capture.url = url;
      return;
    }
    if (!(await this.hasAccount(email))) {
      this.logger.log("Sign-in link requested for an address with no account; not sent");
      return;
    }
    if (!this.magicLinkEmails.allow(email.toLowerCase())) {
      this.logger.warn("Sign-in link not sent: too many requested for this address recently");
      return;
    }
    const origin: string = await this.signInPageOrigin(email, url);
    const confirmUrl = `${origin}/magic-link${new URL(url).search}`;
    const html = await render(MagicLinkEmail({ url: confirmUrl }));
    const organizationId = await this.getPrimaryOrgForEmail(email);
    await this.mail.send(email, "Sign in to Atrium", html, organizationId);
  }

  /**
   * Where the emailed link opens. A client who asked from their agency's custom
   * domain gets it on that domain, so the session lands there too. Only for a
   * member of that workspace: anyone can save a domain on a workspace, and the
   * link must never point a stranger's sign-in at it.
   */
  private async signInPageOrigin(email: string, verifyUrl: string): Promise<string> {
    const webUrl: string = this.config.get("WEB_URL", "http://localhost:3000");
    const callbackURL: string | null = new URL(verifyUrl).searchParams.get("callbackURL");
    if (!callbackURL || !URL.canParse(callbackURL)) return webUrl;
    const host: string = new URL(callbackURL).hostname;
    if (host === new URL(webUrl).hostname) return webUrl;

    const organizationId: string | null = await this.customDomainOrgId(host);
    if (!organizationId) return webUrl;
    const member = await this.prisma.member.findFirst({
      where: { organizationId, user: { email: { equals: email, mode: "insensitive" } } },
      select: { id: true },
    });
    return member ? `https://${host}` : webUrl;
  }

  /**
   * The web and API origins, plus the custom domain a request arrived on when a
   * workspace serves its portal there. Lets the login page on that domain ask
   * for a sign-in link that returns to it.
   */
  async trustedOriginsFor(request?: Request): Promise<string[]> {
    const webUrl: string = this.config.get("WEB_URL", "http://localhost:3000");
    const origins: string[] = [webUrl, publicApiUrl(this.config)];
    const host: string | null = requestHost(request);
    if (!host || origins.some((origin: string) => new URL(origin).hostname === host)) return origins;
    return (await this.customDomainOrgId(host)) ? [...origins, `https://${host}`] : origins;
  }

  /** The workspace serving its portal on this domain, if its plan still includes custom domains. */
  private async customDomainOrgId(host: string): Promise<string | null> {
    try {
      const org = await this.prisma.organization.findUnique({ where: { customDomain: host }, select: { id: true } });
      if (!org) return null;
      return (await this.billingService.hasFeature(org.id, "custom_domain")) ? org.id : null;
    } catch (err) {
      this.logger.error(`Custom domain lookup failed for ${host}`, err instanceof Error ? err.stack : String(err));
      return null;
    }
  }

  /** Whether "Email me a sign-in link" can work: the server or some workspace can send email. */
  async signInLinksAvailable(): Promise<boolean> {
    if (this.config.get("RESEND_API_KEY")) return true;
    return (await this.prisma.systemSettings.count({ where: { emailProvider: { not: null } } })) > 0;
  }

  /** A first password for someone who joined by link. Better Auth refuses if one is already set. */
  async setPassword(requestHeaders: Record<string, string | string[] | undefined>, newPassword: string): Promise<void> {
    const headers = new Headers();
    for (const [key, value] of Object.entries(requestHeaders)) {
      if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    try {
      await this.auth.api.setPassword({ body: { newPassword }, headers });
    } catch (err) {
      if (err instanceof APIError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  private async hasAccount(email: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    return user !== null;
  }

  /** The contact's name when the agency gave one; otherwise the part of the email before the @. */
  private async inviteeName(organizationId: string, email: string): Promise<string> {
    const contact = await this.prisma.contact.findFirst({
      where: { organizationId, email: email.toLowerCase() },
      select: { name: true },
    });
    const name: string = contact?.name.trim() ?? "";
    return name && name.toLowerCase() !== email.toLowerCase() ? name : email.split("@")[0];
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
