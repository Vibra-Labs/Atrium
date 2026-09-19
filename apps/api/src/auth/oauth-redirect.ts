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
  // A comma is fatal, and not for cosmetic reasons: the plugin stores the
  // whole list as `redirect_uris.join(",")` in one column and splits it back
  // on "," at authorize time (plugins/mcp/index.mjs, plugins/mcp/authorize.mjs).
  // So a single entry "https://ok.example/cb,javascript:alert(1)" — a legal
  // https URL, since commas are allowed in a path — is stored verbatim and
  // read back as TWO registered URIs, the second being executable script,
  // which authorize then exact-matches without re-checking the scheme.
  // Checked on the raw string, before parsing, because parsing preserves the
  // comma rather than encoding it. A percent-encoded %2C is fine and stays
  // allowed: nothing in the plugin decodes before splitting.
  if (uri.includes(",")) return false;
  // Also rejects relative paths and anything else without a scheme.
  if (!URL.canParse(uri)) return false;
  const scheme: string = new URL(uri).protocol.toLowerCase();
  return !DENIED_SCHEMES.has(scheme);
}
