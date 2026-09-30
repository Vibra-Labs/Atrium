/**
 * When /login was reached from an MCP OAuth flow, the original authorize
 * query is in the URL. After sign-in we send the browser back to the
 * authorize endpoint with it, as a top-level navigation.
 */
export function oauthResumeUrl(search: string, apiUrl: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.get("client_id") || !params.get("response_type")) return null;
  // Keep the query byte-for-byte as the authorization server issued it.
  return `${apiUrl}/api/auth/mcp/authorize?${search.replace(/^\?/, "")}`;
}
