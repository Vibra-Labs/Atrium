import { Logger } from "@nestjs/common";

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

/** Parses a request's originalUrl. Concatenated, not a base URL: "//x/..." would otherwise parse as a host. */
export function parseOriginalUrl(originalUrl: string): URL {
  return new URL(`http://internal${originalUrl}`);
}

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

/** Whether a request URL names one of the staff-only Better Auth organization routes. */
export function isStaffOnlyOrgRoute(url: URL): boolean {
  return STAFF_ONLY_ORG_ROUTES.has(authRoute(url.pathname));
}
