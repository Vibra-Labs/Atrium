/**
 * Where the Next.js server reaches the API. This is not the API's public URL:
 * in the Docker image it is 127.0.0.1, which a browser can never use.
 *
 * Required in production. There is deliberately no fallback to API_URL: that
 * would quietly send every page render out over the internet and back.
 */
export function resolveInternalApiUrl(env: Record<string, string | undefined>): string {
  if (env.INTERNAL_API_URL) return env.INTERNAL_API_URL.replace(/\/+$/, "");
  if (env.NODE_ENV === "production") {
    throw new Error(
      "INTERNAL_API_URL is not set. Set it to the address the web app reaches the API at, " +
        "e.g. http://atrium-api:3001. See docs/configuration.md#required-for-split-deployments",
    );
  }
  return "http://localhost:3001";
}

/** Headers a server-side call must carry on the visitor's behalf. */
export function forwardHeaders(cookie: string, forwardedFor: string | null): Record<string, string> {
  const headers: Record<string, string> = { Cookie: cookie };
  if (forwardedFor) headers["X-Forwarded-For"] = forwardedFor;
  return headers;
}
