import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { randomBytes } from "crypto";
import { isMcpPath } from "../helpers/mcp-path";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_COOKIE = "csrf-token";
const CSRF_HEADER = "x-csrf-token";
const TOKEN_LENGTH = 32;

/** Cookie names used by Better Auth for session tracking. */
const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
];

/** RFC 7235: the auth-scheme token is case-insensitive. */
const BEARER_SCHEME = /^bearer\s+.+$/i;

/** OAuth discovery documents, served at the origin root. */
const WELL_KNOWN_PREFIX = "/.well-known/";

/** The subset of the Express request this guard reads. */
interface CsrfRequest {
  method: string;
  url?: string;
  originalUrl?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string | string[] | undefined>;
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request: CsrfRequest = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // The csrf-token cookie exists only for the first-party browser app.
    // Never issue it (nor validate it) for non-browser clients: Better Auth's
    // own origin-check middleware treats ANY cookie on a request -- not just
    // its session cookie -- as reason to require a matching Origin header. A
    // cookie-persisting HTTP client (requests.Session(), an MCP client) that
    // picked up our stray cookie here would then be rejected by Better Auth
    // on its next call, e.g. the OAuth token exchange or a refresh, because
    // real OAuth clients never send an Origin header.
    if (this.isNonBrowserClient(request)) {
      return true;
    }

    // Only set the CSRF cookie when one does not already exist.
    // Re-generating on every request would invalidate in-flight requests
    // that already read the previous token value.
    if (!request.cookies?.[CSRF_COOKIE]) {
      const token = randomBytes(TOKEN_LENGTH).toString("hex");
      response.cookie(CSRF_COOKIE, token, {
        httpOnly: false, // Must be readable by JS
        sameSite: "lax",
        secure:
        process.env.SECURE_COOKIES !== undefined
          ? process.env.SECURE_COOKIES === "true"
          : process.env.NODE_ENV === "production",
        path: "/",
      });
      // Also store on the request so validation works on this same request cycle
      if (!request.cookies) request.cookies = {};
      request.cookies[CSRF_COOKIE] = token;
    }

    // Safe methods don't need CSRF validation
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    // Skip CSRF for public endpoints (no session = no CSRF risk)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // Skip CSRF when no auth session cookie exists. If the user has no
    // session there is nothing for a CSRF attack to exploit, and requiring
    // a CSRF token would break unauthenticated POST endpoints like signup.
    const hasSession = SESSION_COOKIE_NAMES.some(
      (name) => !!request.cookies?.[name],
    );
    if (!hasSession) {
      return true;
    }

    // Validate double-submit: cookie value must match header value
    const cookieToken = request.cookies?.[CSRF_COOKIE];
    const headerToken = request.headers?.[CSRF_HEADER];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new ForbiddenException("Invalid or missing CSRF token");
    }

    return true;
  }

  /**
   * Requests that can never be a first-party browser call and so must not be
   * handed (or asked for) a CSRF cookie: the Better Auth proxy, the MCP
   * endpoint, the OAuth discovery documents, and bearer-token clients that
   * carry no Better Auth session cookie (API keys and OAuth access tokens).
   */
  private isNonBrowserClient(request: CsrfRequest): boolean {
    const url: string = request.originalUrl || request.url || "";
    const queryStart: number = url.indexOf("?");
    const path: string = queryStart === -1 ? url : url.slice(0, queryStart);

    if (path.startsWith("/api/auth/")) return true;
    if (isMcpPath(path)) return true;
    if (path.startsWith(WELL_KNOWN_PREFIX)) return true;

    const authorization: string = String(request.headers?.authorization || "");
    const hasSession: boolean = SESSION_COOKIE_NAMES.some(
      (name) => !!request.cookies?.[name],
    );
    return BEARER_SCHEME.test(authorization) && !hasSession;
  }
}
