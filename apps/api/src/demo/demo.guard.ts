import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common";
import { DemoService } from "./demo.service";

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

const UPLOADS_OFF = "Uploads are turned off in the demo.";
const GENERIC_OFF = "That's turned off in the demo.";

/**
 * Write paths the demo permits, as prefixes of the path with /api stripped.
 *
 * An allowlist, not a blocklist. Two independent reviews found the same defect
 * in the blocklist this replaced: it tried to enumerate a surface this guard
 * does not own. Every route it missed was a hole — uploads reached through
 * `POST /documents` rather than `/files/upload`, 2FA enforcement that no reset
 * clears, an organization rename that bricked every later reset — and Better
 * Auth's own routes cannot be enumerated at all.
 *
 * Inverted, the failure mode changes sides: a route nobody thought of simply
 * does not work in the demo, which is visible and harmless, instead of being
 * an open door onto a workspace strangers can write to.
 *
 * Anything added here must be something a reset can undo. Rows that survive a
 * reset on purpose — `User`, `SystemSettings`, `Organization` — are exactly
 * what must stay out.
 */
const ALLOWED_WRITES: readonly string[] = [
  "/projects",
  "/tasks",
  "/updates",
  "/comments",
  "/notes",
  "/invoices",
  "/contacts",
  "/companies",
  "/lead-sources",
  "/labels",
  "/time-entries",
  "/project-statuses",
  "/pursuit-pipelines",
  "/pursuit-stages",
  "/dashboard-layout",
  "/notifications",
  "/email-preferences",
  "/files",
  "/documents",
  "/embeds",
  "/branding",
  "/activity",
  "/search",
  "/calendar",
  // A portal client editing their own contact details. The rest of /clients
  // manages real people and stays out.
  "/clients/me/profile",
  // The demo's own controls.
  "/demo",
  // So a visitor can leave. Every other /auth route is refused: the
  // organization routes can rename or delete the workspace, and change-email
  // would strand the seeded user behind an address the reset no longer knows.
  "/auth/sign-out",
];

/**
 * Refused even though they sit beneath an allowed prefix. These are the upload
 * endpoints: the multipart check already stops a real upload, and this stops
 * the route being reachable at all, whatever body it is handed.
 */
const DENIED_WITHIN_ALLOWED: readonly string[] = [
  "/files/upload",
  "/branding/logo",
  "/invoices/upload",
  "/documents/sign-via-token",
];

/** Refusals a visitor is likely to hit, worded for them rather than for a log. */
const EXPLAINED: readonly { path: string; message: string }[] = [
  { path: "/billing", message: "Billing is turned off in the demo." },
  { path: "/payments", message: "Payments are turned off in the demo." },
  { path: "/auth/organization/invite-member", message: "Inviting people is turned off in the demo." },
  { path: "/invitations", message: "Inviting people is turned off in the demo." },
  { path: "/api-keys", message: "API keys are turned off in the demo." },
  { path: "/mcp-grants", message: "Connecting AI assistants is turned off in the demo." },
  { path: "/integrations", message: "Integrations are turned off in the demo." },
  { path: "/settings/custom-domain", message: "Custom domains are turned off in the demo." },
  { path: "/settings", message: "Workspace settings are turned off in the demo." },
  { path: "/two-factor", message: "Two-factor settings are turned off in the demo." },
  { path: "/auth/two-factor", message: "Two-factor settings are turned off in the demo." },
  { path: "/account", message: "Account changes are turned off in the demo." },
  // A PushSubscription is keyed to the browser, not the workspace, and no reset
  // clears it — a visitor who allowed notifications would go on receiving push
  // about later visitors' activity in the shared demo.
  { path: "/push", message: "Notifications are turned off in the demo." },
  { path: "/auth/organization", message: "Changing the workspace is turned off in the demo." },
];

/**
 * Fences the demo workspace. Runs on every request but only ever refuses one
 * whose resolved organization is the demo workspace, so an ordinary install —
 * and any other workspace on the demo host — is untouched.
 */
@Injectable()
export class DemoGuard implements CanActivate {
  constructor(private demo: DemoService) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    if (!this.demo.enabled) return true;

    const request = executionContext.switchToHttp().getRequest<AuthenticatedRequest>();
    const organizationId: string | undefined = request.organization?.id;
    // No organization resolved: nothing to fence. AuthGuard decides access.
    if (!organizationId) return true;
    if (!(await this.demo.isDemoOrg(organizationId))) return true;

    // Anyone in the demo counts as activity, reads included: a visitor reading
    // the dashboard for six minutes must not be reseeded under.
    this.demo.touch();

    const method: string = request.method.toUpperCase();
    if (SAFE_METHODS.has(method)) return true;

    const path: string = this.pathOf(request);

    // Uploads are refused by capability rather than by route, so this covers
    // every endpoint that takes a file — including ones added later.
    if (this.isMultipart(request)) throw new ForbiddenException(UPLOADS_OFF);

    if (DENIED_WITHIN_ALLOWED.some((denied: string) => this.matches(path, denied))) {
      throw new ForbiddenException(UPLOADS_OFF);
    }

    if (ALLOWED_WRITES.some((allowed: string) => this.matches(path, allowed))) return true;

    const explained = EXPLAINED.find((entry) => this.matches(path, entry.path));
    throw new ForbiddenException(explained?.message ?? GENERIC_OFF);
  }

  /** True when `path` is the prefix itself or a path beneath it. */
  private matches(path: string, prefix: string): boolean {
    return path === prefix || path.startsWith(`${prefix}/`);
  }

  /** The request path without the global /api prefix or a query string. */
  private pathOf(request: AuthenticatedRequest): string {
    const url: string = request.originalUrl || request.url || "";
    const path: string = url.split("?")[0];
    const withoutPrefix: string = path.startsWith("/api") ? path.slice("/api".length) : path;
    // Normalise a trailing slash so "/projects/" matches "/projects".
    return withoutPrefix.length > 1 && withoutPrefix.endsWith("/")
      ? withoutPrefix.slice(0, -1)
      : withoutPrefix;
  }

  private isMultipart(request: AuthenticatedRequest): boolean {
    const header: unknown = request.headers?.["content-type"];
    const contentType: string = Array.isArray(header) ? (header[0] ?? "") : String(header ?? "");
    return contentType.toLowerCase().includes("multipart/form-data");
  }
}
