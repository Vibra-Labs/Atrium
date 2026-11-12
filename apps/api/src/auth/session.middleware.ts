import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response, NextFunction } from "express";
import { AuthService } from "./auth.service";
import { ApiKeysService, API_KEY_PREFIX, hashApiKey } from "../api-keys/api-keys.service";
import { McpAuthService } from "../mcp-auth/mcp-auth.service";
import { LastSeenTracker } from "./last-seen.tracker";
import { SessionCache } from "./session-cache";
import type { CachedSession } from "./session-cache";
import { hasSecondFactor } from "../two-factor/second-factor";
import { isStaffInRequiringWorkspace } from "../two-factor/staff-requirement";
import { isPrivilegedRole } from "../common/helpers/privileged-role";
import { PrismaService } from "../prisma/prisma.service";
import { bearerToken, isMcpPath, mcpOAuthEnabled, ORG_MEMBER_FIELDS, RateLimiter } from "../common";
import type {
  Actor, AuthenticatedRequest, AuthUser, AuthSession, BearerKind, FullOrganization, OrgMember,
} from "../common";

const SESSION_CACHE_TTL = 30_000; // 30 seconds
/** The columns `req.organization` carries (FullOrganization, minus members). */
const ORGANIZATION_FIELDS = {
  id: true, name: true, slug: true, logo: true, createdAt: true, updatedAt: true, metadata: true,
} as const;
const FAILED_KEY_LIMIT = 30;
const FAILED_KEY_WINDOW_MS = 60_000;
const FAILED_KEY_MAX_IPS = 10_000;
/**
 * This limiter gates authentication, so it fails open at capacity: a flood of
 * spoofed client IPs must not lock out valid keys whose cache entry expired.
 */
const FAILED_KEY_FAIL_CLOSED = false;
/** Bucket for the failed-key limiter. `trust proxy` makes this client-supplied. */
function clientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

type AuthReq = Partial<
  Pick<
    AuthenticatedRequest,
    | "user"
    | "session"
    | "organization"
    | "member"
    | "apiKeyId"
    | "bearerKind"
    | "authRateLimited"
    | "workspaceRequiresTwoFactor"
    | "staffInRequiringWorkspace"
    | "sessionLookupFailed"
  >
> &
  Request;

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  /**
   * API-key sessions, keyed by the key hash. Deliberately a separate map: the
   * cookie branch trusts an attacker-controlled token, so a shared map would
   * let anyone who learns a stored keyHash replay it as a session cookie.
   */
  private bearerCache = new Map<string, CachedSession>();
  /**
   * Bad API keys cost a database lookup each, and the MCP controller skips the
   * global throttle, so failures are capped per IP before the lookup runs.
   */
  private readonly failedBearer = new RateLimiter(
    FAILED_KEY_LIMIT,
    FAILED_KEY_WINDOW_MS,
    FAILED_KEY_MAX_IPS,
    FAILED_KEY_FAIL_CLOSED,
  );
  private readonly logger = new Logger(SessionMiddleware.name);

  constructor(
    private authService: AuthService,
    private apiKeys: ApiKeysService,
    private mcpAuth: McpAuthService,
    private config: ConfigService,
    private lastSeen: LastSeenTracker,
    private prisma: PrismaService,
    /** Cookie sessions, keyed by the raw session token. Shared so others can drop a user's entries. */
    private cache: SessionCache = new SessionCache(),
  ) {}

  private extractSessionToken(req: Request): string | undefined {
    // Check common Better Auth cookie names
    const cookies = req.cookies || {};
    return (
      cookies["better-auth.session_token"] ||
      cookies["__Secure-better-auth.session_token"] ||
      cookies["__session"]
    );
  }

  private extractApiKey(req: Request): string | undefined {
    const token: string | undefined = bearerToken(req.headers.authorization);
    return token?.startsWith(API_KEY_PREFIX) ? token : undefined;
  }

  /**
   * OAuth access tokens are honoured on the MCP endpoint only, never on the
   * REST API — and not at all once the operator has turned OAuth off, since
   * tokens minted before the switch outlive it by up to an hour and the
   * Connected apps UI that would disconnect them is hidden.
   */
  private extractOAuthToken(req: Request): string | undefined {
    if (!mcpOAuthEnabled(this.config)) return undefined;
    if (!isMcpPath(req.originalUrl)) return undefined;
    const token: string | undefined = bearerToken(req.headers.authorization);
    return token && !token.startsWith(API_KEY_PREFIX) ? token : undefined;
  }

  /** Resolves a bearer token into the same request fields a cookie session sets. */
  private async applyBearer(authReq: AuthReq, token: string, kind: BearerKind): Promise<void> {
    // Cache under the hash so raw tokens are not held in memory.
    const cacheKey: string = `${kind}:${hashApiKey(token)}`;
    let entry: CachedSession | undefined = this.bearerCache.get(cacheKey);
    if (entry && entry.expiresAt <= Date.now()) {
      this.bearerCache.delete(cacheKey);
      entry = undefined;
    }

    if (!entry) {
      const ip: string = clientIp(authReq);
      if (this.failedBearer.isLimited(ip)) {
        authReq.authRateLimited = true;
        return;
      }
      let resolved: (Actor & { apiKeyId?: string }) | null;
      try {
        // OAuth lookups cost a database round trip too, so both kinds are limited.
        resolved =
          kind === "apiKey" ? await this.apiKeys.resolve(token) : await this.mcpAuth.resolve(token);
      } catch (err) {
        // A lookup that throws still cost us a database round trip, so it
        // counts against the IP. use() logs and continues unauthenticated.
        this.failedBearer.allow(ip);
        throw err;
      }
      if (!resolved) {
        this.failedBearer.allow(ip);
        return;
      }
      const now: Date = new Date();
      entry = {
        user: resolved.user,
        organization: resolved.organization,
        member: resolved.member,
        apiKeyId: resolved.apiKeyId,
        bearerKind: kind,
        session: {
          id: kind === "apiKey" ? `apikey:${resolved.apiKeyId}` : `${kind}:${resolved.user.id}`,
          token: "",
          userId: resolved.user.id,
          activeOrganizationId: resolved.organization.id,
          expiresAt: new Date(now.getTime() + SESSION_CACHE_TTL),
          createdAt: now,
          updatedAt: now,
          ipAddress: null,
          userAgent: null,
        },
        expiresAt: now.getTime() + SESSION_CACHE_TTL,
      };
      this.bearerCache.set(cacheKey, entry);
      if (this.bearerCache.size > 1000) this.evict(this.bearerCache);
    }

    authReq.user = entry.user;
    authReq.session = entry.session;
    authReq.organization = entry.organization;
    authReq.member = entry.member;
    authReq.apiKeyId = entry.apiKeyId;
    authReq.bearerKind = entry.bearerKind;
  }

  /** A session the second-factor gate restricts: not yet stepped up, or owing 2FA setup. */
  private isGated(authReq: AuthReq): boolean {
    const user: AuthUser | undefined = authReq.user;
    if (!user) return false;
    if (hasSecondFactor(user)) return !authReq.session?.secondFactor;
    return authReq.workspaceRequiresTwoFactor === true && isPrivilegedRole(authReq.member?.role);
  }

  /** Drops expired entries from a cache that has grown past its soft cap. */
  private evict(cache: Map<string, CachedSession>): void {
    const now: number = Date.now();
    for (const [key, val] of cache) {
      if (val.expiresAt < now) cache.delete(key);
    }
  }

  async use(req: Request, _res: Response, next: NextFunction) {
    const authReq = req as AuthReq;

    const token = this.extractSessionToken(req);
    const isAuthRoute = req.originalUrl.startsWith("/api/auth/");
    try {

      // API keys apply only when there is no browser session, so the
      // cookie + CSRF model is never mixed with bearer auth. This runs before
      // the /api/auth/ handling on purpose: bearer auth never touches Better
      // Auth session state, so those routes need no special casing here.
      if (!token) {
        const apiKey: string | undefined = this.extractApiKey(req);
        const oauthToken: string | undefined = apiKey ? undefined : this.extractOAuthToken(req);
        if (apiKey || oauthToken) {
          await this.applyBearer(authReq, (apiKey ?? oauthToken) as string, apiKey ? "apiKey" : "oauth");
          return next();
        }
      }

      // Better Auth routes mutate session state (login, set-active org, ...),
      // so the cached entry is dropped. The caller is still resolved: the auth
      // proxy gates staff-only organization routes on the caller's role, and
      // SecondFactorGuard gates every route on the session's second factor.
      if (isAuthRoute) {
        if (!token) return next();
        // Resolved afresh (never from the cache, and never written back) for
        // the auth proxy's staff-only checks and the second-factor gate.
        this.cache.delete(token);
      }

      if (!isAuthRoute && token) {
        const cached: CachedSession | undefined = this.cache.get(token);
        if (cached) {
          authReq.user = cached.user;
          authReq.session = cached.session;
          authReq.workspaceRequiresTwoFactor = cached.workspaceRequiresTwoFactor;
          if (cached.organization) authReq.organization = cached.organization;
          if (cached.member) {
            authReq.member = cached.member;
            void this.lastSeen.touch(cached.member.id);
          }
          return next();
        }
      }

      // Build headers from the incoming request, but override the host
      // so Better Auth resolves the correct cookie name (__Secure- prefix
      // requires HTTPS). The internal proxy chain may rewrite Host to an
      // internal Cloud Run hostname, which breaks cookie lookup.
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value) headers.set(key, Array.isArray(value) ? value[0] : value);
      }

      const session = await this.authService.auth.api.getSession({
        headers,
      });

      if (session) {
        // Looked up rather than stored: the passkey plugin writes rows without
        // database hooks, so a stored flag could drift and silently un-gate a user.
        const passkey = await this.prisma.passkey.findFirst({
          where: { userId: session.user.id },
          select: { id: true },
        });
        authReq.user = { ...(session.user as AuthUser), hasPasskey: passkey !== null };
        authReq.session = session.session as AuthSession;
      }

      const activeOrgId = (
        session?.session as { activeOrganizationId?: string } | undefined
      )?.activeOrganizationId;
      if (session && activeOrgId) {
        // Two indexed reads instead of Better Auth's getFullOrganization, which
        // loads every member (capped at 100, so anyone past that lost their role).
        const [organization, member, settings] = await Promise.all([
          this.prisma.organization.findUnique({ where: { id: activeOrgId }, select: ORGANIZATION_FIELDS }),
          this.prisma.member.findFirst({
            where: { organizationId: activeOrgId, userId: session.user.id },
            select: ORG_MEMBER_FIELDS,
          }),
          this.prisma.systemSettings.findUnique({
            where: { organizationId: activeOrgId },
            select: { requireTwoFactor: true },
          }),
        ]);
        // Organization only alongside a membership, as before: AuthGuard reads
        // req.organization as "a member of the active workspace".
        if (organization && member) {
          authReq.organization = organization;
          authReq.member = member;
          authReq.workspaceRequiresTwoFactor = settings?.requireTwoFactor === true;
          // Cookie sessions only: an API key or MCP client is not a person visiting.
          void this.lastSeen.touch(member.id);
        }
      }

      // Better Auth's organization routes can name any workspace, so on auth
      // routes the gate also needs to know whether 2FA setup is owed anywhere.
      if (isAuthRoute && session && authReq.user && !hasSecondFactor(authReq.user)) {
        authReq.staffInRequiringWorkspace = await isStaffInRequiringWorkspace(this.prisma, session.user.id);
      }

      // Cache the resolved session. Not on auth routes: they may change it.
      // Not a gated one either: it changes on step-up or setup, possibly on
      // another API instance, and must not be served stale.
      if (token && session && !isAuthRoute && !this.isGated(authReq)) {
        this.cache.set(token, {
          user: authReq.user as AuthUser,
          session: authReq.session as AuthSession,
          organization: authReq.organization,
          member: authReq.member,
          workspaceRequiresTwoFactor: authReq.workspaceRequiresTwoFactor,
          expiresAt: Date.now() + SESSION_CACHE_TTL,
        });
      }
    } catch (err) {
      // Session resolution failed — continue without auth.
      // The AuthGuard will reject unauthenticated requests. The auth proxy is
      // public and authenticates by itself, so SecondFactorGuard refuses it.
      this.logger.warn(`Session resolution failed: ${err instanceof Error ? err.message : String(err)}`);
      if (token && isAuthRoute && !authReq.user) authReq.sessionLookupFailed = true;
    }

    next();
  }
}
