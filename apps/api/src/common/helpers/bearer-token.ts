/** RFC 7235: the auth-scheme token is case-insensitive. */
const BEARER_SCHEME = /^bearer\s+(.+)$/i;

/**
 * The credentials from an `Authorization: Bearer <token>` header, or undefined
 * when the header is absent, uses another scheme, or carries no token at all
 * (`"Bearer   "`).
 *
 * Shared deliberately: `SessionMiddleware` decides who is authenticated with
 * it and `CsrfGuard` decides who is a non-browser client with it, so the two
 * must not be able to disagree about what counts as a bearer request.
 */
export function bearerToken(header: string | undefined): string | undefined {
  const match: RegExpMatchArray | null = header ? BEARER_SCHEME.exec(header) : null;
  const token: string = match ? match[1].trim() : "";
  return token || undefined;
}
