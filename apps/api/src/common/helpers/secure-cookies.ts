type Env = Record<string, string | undefined>;

/**
 * The public URL the operator set, read raw: no localhost default, so an
 * unset URL can never be mistaken for plain HTTP. Same order as publicApiUrl,
 * which is Better Auth's base URL. In the Docker image API_URL = WEB_URL.
 */
function configuredUrl(env: Env): string {
  return (env.API_URL || env.BETTER_AUTH_URL || env.WEB_URL || "").trim().toLowerCase();
}

/**
 * Whether auth and CSRF cookies get the Secure flag.
 *
 * Browsers drop Secure cookies on plain http:// (except localhost), so a
 * production install opened at http://<host>:<port> could sign in but never
 * stay signed in (#94). Order:
 *   1. SECURE_COOKIES, when set to a non-blank value, always wins. A blank
 *      value (e.g. an empty field in Portainer) counts as unset.
 *   2. An explicit http:// URL turns Secure off.
 *   3. Otherwise Secure in production, as before. This covers an unset URL,
 *      https://, and anything malformed.
 */
export function secureCookies(env: Env = process.env): boolean {
  const explicit: string = (env.SECURE_COOKIES ?? "").trim();
  if (explicit) return explicit === "true";
  if (configuredUrl(env).startsWith("http://")) return false;
  return env.NODE_ENV === "production";
}

/** True when a production install sends cookies without the Secure flag. */
export function insecureCookiesInProduction(env: Env = process.env): boolean {
  return env.NODE_ENV === "production" && !secureCookies(env);
}

/** A startup warning about the cookie setup, or null when there is nothing to say. */
export function cookieUrlWarning(env: Env = process.env): string | null {
  if (insecureCookiesInProduction(env)) {
    return "Sign-in cookies are not Secure because Atrium is served over plain HTTP. Logins and sessions travel unencrypted. Use HTTPS (a Cloudflare tunnel or a reverse proxy) for anything beyond a trusted local network.";
  }
  return null;
}
