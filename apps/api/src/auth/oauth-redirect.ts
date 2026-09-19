/**
 * Which redirect URIs an OAuth client may register.
 *
 * `POST /api/auth/mcp/register` is anonymous dynamic registration, and the
 * consent page navigates the user's browser to the registered URI after
 * Allow/Deny. A `javascript:` or `data:` URI would therefore run script in the
 * Atrium web origin. The consent page refuses such URIs too, but the server
 * must refuse to store them so the control doesn't rest on one client.
 *
 * This is deliberately a DENYLIST, not an allowlist: native MCP clients
 * legitimately register custom schemes (`cursor://`, `vscode://`, `claude://`)
 * and `http://127.0.0.1:<port>/` loopbacks, and those must keep working.
 */
const DENIED_SCHEMES: ReadonlySet<string> = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "blob:",
  "file:",
  "about:",
]);

export function isAllowedRedirectUri(uri: string): boolean {
  // Also rejects relative paths and anything else without a scheme.
  if (!URL.canParse(uri)) return false;
  const scheme: string = new URL(uri).protocol.toLowerCase();
  return !DENIED_SCHEMES.has(scheme);
}
