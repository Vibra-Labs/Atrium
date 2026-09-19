import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { AuthService } from "./auth.service";
import { ApiKeysService, API_KEY_PREFIX, hashApiKey } from "../api-keys/api-keys.service";
import { RateLimiter } from "../common";
import type { AuthenticatedRequest, AuthUser, AuthSession, FullOrganization, OrgMember } from "../common";

interface CachedSession {
  user: AuthUser;
  session: AuthSession;
  organization?: FullOrganization;
  member?: OrgMember;
  apiKeyId?: string;
  expiresAt: number;
}

const SESSION_CACHE_TTL = 30_000; // 30 seconds
const FAILED_KEY_LIMIT = 30;
const FAILED_KEY_WINDOW_MS = 60_000;

/** Bucket for the failed-key limiter. `trust proxy` makes this client-supplied. */
function clientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

type AuthReq = Partial<
  Pick<
    AuthenticatedRequest,
    "user" | "session" | "organization" | "member" | "apiKeyId" | "authRateLimited"
  >
> &
  Request;

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  /** Cookie sessions, keyed by the raw session token. */
  private cache = new Map<string, CachedSession>();
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
  private readonly failedBearer = new RateLimiter(FAILED_KEY_LIMIT, FAILED_KEY_WINDOW_MS);
  private readonly logger = new Logger(SessionMiddleware.name);

  constructor(
    private authService: AuthService,
    private apiKeys: ApiKeysService,
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
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return undefined;
    const token: string = header.slice(7).trim();
    return token.startsWith(API_KEY_PREFIX) ? token : undefined;
  }

  /** Resolves an API key into the same request fields a cookie session sets. */
  private async applyApiKey(authReq: AuthReq, apiKey: string): Promise<void> {
    // Cache under the hash so raw keys are not held in memory.
    const cacheKey: string = hashApiKey(apiKey);
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
      const resolved = await this.apiKeys.resolve(apiKey);
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
        session: {
          id: `apikey:${resolved.apiKeyId}`,
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

    try {
      const token = this.extractSessionToken(req);
      const isAuthRoute = req.originalUrl.startsWith("/api/auth/");

      // API keys apply only when there is no browser session, so the
      // cookie + CSRF model is never mixed with bearer auth. This runs before
      // the /api/auth/ handling on purpose: bearer auth never touches Better
      // Auth session state, so those routes need no special casing here.
      if (!token) {
        const apiKey: string | undefined = this.extractApiKey(req);
        if (apiKey) {
          await this.applyApiKey(authReq, apiKey);
          return next();
        }
      }

      // Auth routes mutate session state (login, set-active org, etc.)
      // so always bypass cache and invalidate stale entries
      if (isAuthRoute && token) {
        this.cache.delete(token);
      }

      // Check cache first (skip for auth routes)
      if (!isAuthRoute && token) {
        const cached = this.cache.get(token);
        if (cached && cached.expiresAt > Date.now()) {
          authReq.user = cached.user;
          authReq.session = cached.session;
          if (cached.organization) authReq.organization = cached.organization;
          if (cached.member) authReq.member = cached.member;
          return next();
        }
        // Expired — remove stale entry
        if (cached) this.cache.delete(token);
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
        authReq.user = session.user as AuthUser;
        authReq.session = session.session as AuthSession;
      }

      const activeOrgId = (
        session?.session as { activeOrganizationId?: string } | undefined
      )?.activeOrganizationId;
      if (activeOrgId) {
        const getFullOrg = (
          this.authService.auth.api as unknown as Record<
            string,
            | ((opts: { headers: Headers }) => Promise<FullOrganization | null>)
            | undefined
          >
        ).getFullOrganization;
        if (getFullOrg) {
          const orgData = await getFullOrg({ headers });

          if (orgData) {
            authReq.organization = orgData as FullOrganization;
            const member = orgData.members?.find(
              (m: OrgMember) => m.userId === session!.user.id,
            );
            if (member) {
              authReq.member = member;
            }
          }
        }
      }

      // Cache the resolved session
      if (token && session) {
        this.cache.set(token, {
          user: authReq.user as AuthUser,
          session: authReq.session as AuthSession,
          organization: authReq.organization,
          member: authReq.member,
          expiresAt: Date.now() + SESSION_CACHE_TTL,
        });

        // Evict old entries periodically
        if (this.cache.size > 1000) this.evict(this.cache);
      }
    } catch (err) {
      // Session resolution failed — continue without auth.
      // The AuthGuard will reject unauthenticated requests.
      this.logger.warn(`Session resolution failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    next();
  }
}
