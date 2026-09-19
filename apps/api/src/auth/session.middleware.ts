import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { AuthService } from "./auth.service";
import { ApiKeysService, API_KEY_PREFIX, hashApiKey } from "../api-keys/api-keys.service";
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

type AuthReq = Partial<
  Pick<AuthenticatedRequest, "user" | "session" | "organization" | "member" | "apiKeyId">
> &
  Request;

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  private cache = new Map<string, CachedSession>();
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
    let entry: CachedSession | undefined = this.cache.get(cacheKey);
    if (entry && entry.expiresAt <= Date.now()) {
      this.cache.delete(cacheKey);
      entry = undefined;
    }

    if (!entry) {
      const resolved = await this.apiKeys.resolve(apiKey);
      if (!resolved) return;
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
      this.cache.set(cacheKey, entry);
    }

    authReq.user = entry.user;
    authReq.session = entry.session;
    authReq.organization = entry.organization;
    authReq.member = entry.member;
    authReq.apiKeyId = entry.apiKeyId;
  }

  async use(req: Request, _res: Response, next: NextFunction) {
    const authReq = req as AuthReq;

    try {
      const token = this.extractSessionToken(req);
      const isAuthRoute = req.originalUrl.startsWith("/api/auth/");

      // API keys apply only when there is no browser session, so the
      // cookie + CSRF model is never mixed with bearer auth.
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
        if (this.cache.size > 1000) {
          const now = Date.now();
          for (const [key, val] of this.cache) {
            if (val.expiresAt < now) this.cache.delete(key);
          }
        }
      }
    } catch (err) {
      // Session resolution failed — continue without auth.
      // The AuthGuard will reject unauthenticated requests.
      this.logger.warn(`Session resolution failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    next();
  }
}
