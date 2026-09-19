/**
 * The OAuth surface that third-party MCP clients must be able to reach from
 * any origin: dynamic client registration, the token endpoint, and the
 * discovery documents. Everything else on this API is first-party only and
 * keeps the credentialed, single-origin CORS policy.
 */
const PUBLIC_OAUTH_PATHS: ReadonlySet<string> = new Set([
  "/api/auth/mcp/register",
  "/api/auth/mcp/token",
]);

/** Discovery documents, served at the origin root (see main.ts prefix excludes). */
const WELL_KNOWN_OAUTH_PREFIX = "/.well-known/oauth-";

/** True when `path` (a request URL, query string allowed) is part of that surface. */
export function isPublicOAuthPath(path: string): boolean {
  const queryStart: number = path.indexOf("?");
  const pathname: string = queryStart === -1 ? path : path.slice(0, queryStart);
  return (
    PUBLIC_OAUTH_PATHS.has(pathname) ||
    pathname.startsWith(WELL_KNOWN_OAUTH_PREFIX)
  );
}
