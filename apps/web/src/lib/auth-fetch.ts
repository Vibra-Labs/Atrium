const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/** What a session-setting call to the Better Auth proxy came back with. */
export interface AuthResult {
  ok: boolean;
  /** The server's own message, when it sent one. */
  message?: string;
  /** HTTP status; 0 when there was none to read (network error, opaque redirect). */
  status: number;
  /** Better Auth's error code, when the body carried one. */
  code?: string;
}

const UNREACHABLE = "Could not reach the server. Check your connection and try again.";
const NOT_SIGNED_IN = "Sign-in did not complete. Please try again.";

/** Whether the browser now holds a Better Auth session. */
async function hasSession(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/auth/get-session`, { credentials: "include" });
    if (!res.ok) return false;
    const data: unknown = await res.json();
    return typeof data === "object" && data !== null && Boolean((data as { user?: unknown }).user);
  } catch (err) {
    console.error(err);
    return false;
  }
}

/**
 * Posts to a Better Auth endpoint that sets a session (sign-in, sign-up).
 *
 * Redirects are never followed. Better Auth answers a session-setting request
 * with a 302 whenever a signed `oidc_login_prompt` cookie is present — which
 * any page can inherit for ten minutes from an MCP connection the user
 * abandoned — and following that from `fetch` surfaces as "Failed to fetch"
 * for someone who is in fact signed in. Equally, the redirect on its own is no
 * proof of a session, so one is confirmed with `get-session` before the call
 * is reported as a success. Callers decide where to go next.
 */
export async function postAuth(path: string, body: unknown): Promise<AuthResult> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/auth${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
      redirect: "manual",
    });
  } catch (err) {
    console.error(err);
    return { ok: false, status: 0, message: UNREACHABLE };
  }

  if (res.type === "opaqueredirect") {
    return (await hasSession())
      ? { ok: true, status: 0 }
      : { ok: false, status: 0, message: NOT_SIGNED_IN };
  }

  if (res.ok) return { ok: true, status: res.status };

  const data = (await res.json().catch((err: unknown) => {
    console.error(err);
    return {};
  })) as { message?: string; code?: string };
  return { ok: false, status: res.status, message: data.message, code: data.code };
}
