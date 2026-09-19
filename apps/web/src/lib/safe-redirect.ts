/**
 * OAuth clients register their own `redirect_uris` at (open) dynamic client
 * registration. Native MCP clients legitimately use custom schemes
 * (`cursor://…`, `vscode://…`) and `http://127.0.0.1:<port>/…` loopbacks, so
 * this is a denylist of script-capable/unsafe schemes rather than an
 * http(s)-only allowlist.
 */
const UNSAFE_SCHEMES = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "blob:",
  "file:",
  "about:",
]);

export function isSafeOAuthRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch (err) {
    console.error(err);
    return false;
  }
  // `URL` lowercases `protocol` already, but be explicit rather than relying
  // on that implementation detail.
  return !UNSAFE_SCHEMES.has(url.protocol.toLowerCase());
}
