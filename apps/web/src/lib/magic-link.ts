/** Where the login page remembers the last address a link was sent to. */
export const LAST_EMAIL_KEY = "atrium:last-sign-in-email";

/** A same-site path to return to after sign-in, or null for anything that could leave the site. */
export function safeNextPath(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}

/**
 * The emailed link opens /magic-link with the verify query; pressing its button
 * sends the browser here. Kept off the email itself because mail scanners
 * fetch every link, and a fetch of the verify endpoint spends the token.
 */
export function magicLinkVerifyUrl(search: string, apiUrl: string): string | null {
  if (!new URLSearchParams(search).get("token")) return null;
  return `${apiUrl}/api/auth/magic-link/verify?${search.replace(/^\?/, "")}`;
}

/** Better Auth sends a failed verify back with ?error=<code>. */
export function magicLinkErrorMessage(error: string | null): string | null {
  if (!error) return null;
  return "That sign-in link has expired or was already used. Request a new one below.";
}
