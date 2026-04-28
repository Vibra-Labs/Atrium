const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function getCsrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith("csrf-token="));
  return match ? match.split("=")[1] : undefined;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function doFetch(
  path: string,
  options: RequestInit,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const method = (options.method || "GET").toUpperCase();
  if (MUTATING_METHODS.has(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers["x-csrf-token"] = csrfToken;
    }
  }

  return fetch(`${API_URL}/api${path}`, {
    ...options,
    credentials: "include",
    headers,
  });
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let res = await doFetch(path, options);

  // If a mutating request is rejected with a CSRF error, the response will
  // have set the csrf-token cookie. Re-read it and retry once.
  const method = (options.method || "GET").toUpperCase();
  if (res.status === 403 && MUTATING_METHODS.has(method)) {
    const body = await res.json().catch(() => ({}));
    const message: string = (body as Record<string, unknown>).message as string || "";
    if (message.toLowerCase().includes("csrf")) {
      res = await doFetch(path, options);
    } else {
      throw new Error(message || `API error: ${res.status}`);
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, unknown>).message as string || `API error: ${res.status}`);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * After authentication, sets the active org and returns the redirect path
 * based on the user's role (owner/admin -> /dashboard, member -> /portal).
 *
 * `preferredOrgId` is used when the caller knows which org the user is acting
 * on (e.g. the org they just accepted an invite to). Without it, users who
 * belong to multiple orgs would be routed by an arbitrary `orgs[0]`, which
 * can land an invited client on the dashboard of an unrelated org they own.
 */
export async function setActiveOrgAndRedirect(
  defaultPath = "/portal",
  preferredOrgId?: string,
): Promise<string> {
  const orgsRes = await fetch(`${API_URL}/api/auth/organization/list`, {
    credentials: "include",
  });
  if (!orgsRes.ok) return defaultPath;

  const orgs: { id: string }[] = await orgsRes.json();
  if (!orgs?.length) return defaultPath;

  const targetOrgId =
    preferredOrgId && orgs.some((o) => o.id === preferredOrgId)
      ? preferredOrgId
      : orgs[0].id;

  await fetch(`${API_URL}/api/auth/organization/set-active`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId: targetOrgId }),
    credentials: "include",
  });

  const memberRes = await fetch(
    `${API_URL}/api/auth/organization/get-active-member`,
    { credentials: "include" },
  );
  if (!memberRes.ok) return defaultPath;

  const member = await memberRes.json();
  const role = member?.role || "member";
  return role === "owner" || role === "admin" ? "/dashboard" : defaultPath;
}
