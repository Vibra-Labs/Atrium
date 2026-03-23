import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { randomBytes } from "crypto";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_COOKIE = "csrf-token";
const CSRF_HEADER = "x-csrf-token";
const TOKEN_LENGTH = 32;

/** Cookie names used by Better Auth for session tracking. */
const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
];

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

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

    // Skip CSRF for auth proxy routes -- Better Auth handles its own CSRF protection
    const url: string = request.originalUrl || request.url || "";
    if (url.startsWith("/api/auth/")) {
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
}
