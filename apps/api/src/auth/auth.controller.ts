import { All, Controller, ForbiddenException, Logger, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ROLES } from "@atrium/shared";
import { AuthService } from "./auth.service";
import { Public } from "../common";
import type { AuthenticatedRequest } from "../common";
import type { Request, Response } from "express";
import { publicApiUrl } from "../common/helpers/public-api-url";

/**
 * Request headers that must not be forwarded: the proxy re-serializes the
 * parsed body, so the original framing no longer matches what is sent.
 */
const SKIPPED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "content-length",
  "transfer-encoding",
]);

/**
 * Re-encode an urlencoded body that Express already parsed. Nest's parser runs
 * with `extended: true`, so a value is a string, an array of strings (repeated
 * keys) or a nested object; only the first two are valid urlencoded output and
 * anything else is dropped rather than stringified into garbage.
 */
function encodeForm(body: Record<string, unknown> | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body ?? {})) {
    if (typeof value === "string") {
      params.append(key, value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") params.append(key, item);
      }
    }
  }
  return params.toString();
}

/**
 * Better Auth organization routes that return other members or invitations
 * with no permission check beyond membership. Portal clients are members too,
 * so these are staff-only. (Teams aren't enabled, so list-team-members and
 * friends don't exist.)
 */
const STAFF_ONLY_ORG_ROUTES: ReadonlySet<string> = new Set([
  "/organization/get-full-organization",
  "/organization/list-members",
  "/organization/list-invitations",
  "/organization/get-active-member-role",
]);
const STAFF_ROLES: ReadonlySet<string> = new Set([ROLES.OWNER, ROLES.ADMIN]);

/** The Better Auth route a URL names, in a canonical spelling. */
function authRoute(pathname: string): string {
  let decoded: string = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (err) {
    // Malformed escapes: match on the raw path; Better Auth won't route it either.
    Logger.warn(`Undecodable auth path ${pathname}: ${String(err)}`, "AuthController");
  }
  return decoded
    .toLowerCase()
    .replace(/\/{2,}/g, "/")
    .replace(/^\/api\/auth/, "")
    .replace(/\/+$/, "");
}

/**
 * Refuses staff-only organization routes unless the caller is owner/admin of
 * the active workspace, and refuses them naming any other workspace: the role
 * SessionMiddleware resolved belongs to the active one only.
 */
function assertMayReadOrg(req: Request): void {
  // Concatenated, not a base URL: "//x/..." would otherwise parse as a host.
  const url: URL = new URL(`http://internal${req.originalUrl}`);
  if (!STAFF_ONLY_ORG_ROUTES.has(authRoute(url.pathname))) return;

  const { organization, member } = req as Partial<Pick<AuthenticatedRequest, "organization" | "member">>;
  if (!organization || !member || !STAFF_ROLES.has(member.role)) {
    throw new ForbiddenException("Insufficient permissions");
  }
  const orgId: string | null = url.searchParams.get("organizationId");
  const orgSlug: string | null = url.searchParams.get("organizationSlug");
  if ((orgId && orgId !== organization.id) || (orgSlug && orgSlug !== organization.slug)) {
    throw new ForbiddenException("Insufficient permissions");
  }
}

// Better Auth authenticates its own routes (sign-in lives here), so this proxy
// is deliberately outside AuthGuard.
@Controller("auth")
@Public()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly publicOrigin: string;

  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {
    this.publicOrigin = publicApiUrl(this.config);
  }

  @All("*path")
  async handleAuth(@Req() req: Request, @Res() res: Response) {
    assertMayReadOrg(req);
    const url = `${this.publicOrigin}${req.originalUrl}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      // The body is re-serialized below, so the original framing headers no
      // longer describe it. `host` stays: Better Auth derives cookie names
      // and the resolved base URL from it.
      if (SKIPPED_REQUEST_HEADERS.has(key.toLowerCase())) continue;
      if (value) headers.set(key, Array.isArray(value) ? value[0] : value);
    }

    this.logger.log(`${req.method} ${req.originalUrl}`);

    // Express's body parser has already consumed the raw request stream and
    // parsed it into req.body according to Content-Type. Re-serialize it the
    // same way for Better Auth: the OAuth token endpoint requires a real
    // application/x-www-form-urlencoded body per spec, so JSON.stringify-ing
    // it here (while the Content-Type header still says urlencoded) silently
    // broke every form-encoded request, including the MCP token exchange.
    let requestBody: string | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const contentType = String(req.headers["content-type"] || "");
      requestBody = contentType.includes("application/x-www-form-urlencoded")
        ? encodeForm(req.body as Record<string, unknown>)
        : JSON.stringify(req.body);
    }

    const webRequest = new globalThis.Request(url, {
      method: req.method,
      headers,
      body: requestBody,
    });

    const response = await this.authService.handleRequest(webRequest);

    // Convert Web API Response back to Express
    res.status(response.status);

    // Collect Set-Cookie headers individually to avoid overwrite
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];

    if (setCookies.length > 0) {
      res.setHeader("set-cookie", setCookies);
    }

    // Never forward Better Auth's own CORS headers: main.ts's CORS delegate
    // already set the right Access-Control-* headers for this route before
    // the controller ran -- wildcard and credential-less on the public OAuth
    // surface, the single web origin with credentials everywhere else.
    // Better Auth sets its own wildcard CORS headers on some responses --
    // e.g. redirects issued mid OAuth-login-resume -- which are fine for a
    // top-level navigation but fail any credentialed fetch() call outright,
    // since browsers reject `Access-Control-Allow-Origin: *` together with
    // `credentials: "include"`. Forwarding them here would silently clobber
    // the correct headers already on the response.
    response.headers.forEach((value: string, key: string) => {
      const lower = key.toLowerCase();
      if (lower === "set-cookie" || lower.startsWith("access-control-")) return;
      res.setHeader(key, value);
    });

    const body = await response.text();
    if (body) {
      res.send(body);
    } else {
      res.end();
    }
  }
}
