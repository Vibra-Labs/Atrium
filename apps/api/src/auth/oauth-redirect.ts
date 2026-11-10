/**
 * Which redirect URIs an OAuth client may register.
 *
 * `POST /api/auth/oauth2/register` is anonymous dynamic registration, and the
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
  // No commas. Better Auth's pre-1.7 OAuth plugin stored the list joined by
  // "," and split it back at authorize time, so "https://ok.example/cb,
  // javascript:alert(1)" read back as two URIs, one of them script. The
  // current plugin stores a real array, but no legitimate client needs a raw
  // comma, so the rule stays. A percent-encoded %2C is fine.
  if (uri.includes(",")) return false;
  // Also rejects relative paths and anything else without a scheme.
  if (!URL.canParse(uri)) return false;
  const scheme: string = new URL(uri).protocol.toLowerCase();
  return !DENIED_SCHEMES.has(scheme);
}
