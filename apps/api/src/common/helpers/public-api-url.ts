/**
 * The URL browsers, OAuth clients and Stripe use to reach this API: Better
 * Auth's base URL, OAuth metadata, webhook and logo links.
 *
 * API_URL is canonical; BETTER_AUTH_URL is the pre-1.4 name. Trailing slashes
 * are stripped because they reach OAuth metadata as `//.well-known/...`.
 */
export function publicApiUrl(config: { get: (key: string) => string | undefined }): string {
  return (config.get("API_URL") || config.get("BETTER_AUTH_URL") || "http://localhost:3001").replace(/\/+$/, "");
}
