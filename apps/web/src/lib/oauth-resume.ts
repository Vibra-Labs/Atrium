/** What Better Auth adds when it signs the authorize query onto /login. */
const SIGNING_PARAMS: ReadonlySet<string> = new Set(["sig", "exp"]);

/**
 * When /login was reached from an MCP OAuth flow, the original authorize
 * query is in the URL. After sign-in we send the browser back to the
 * authorize endpoint with it, as a top-level navigation.
 */
export function oauthResumeUrl(search: string, apiUrl: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.get("client_id") || !params.get("response_type")) return null;
  // Authorize re-checks everything itself; the signature only proved the
  // query to /login, so leave it (and Better Auth's ba_* markers) behind.
  for (const key of [...params.keys()]) {
    if (SIGNING_PARAMS.has(key) || key.startsWith("ba_")) params.delete(key);
  }
  return `${apiUrl}/api/auth/oauth2/authorize?${params.toString()}`;
}
