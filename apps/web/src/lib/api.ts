import { getStoredPreviewClientId } from "./preview-mode";

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

  const previewClientId = getStoredPreviewClientId();
  if (previewClientId) {
    if (MUTATING_METHODS.has(method)) {
      throw new Error("Read-only preview mode");
    }
    headers["X-Preview-As"] = previewClientId;
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

export interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/** Max `limit` accepted by paginated list endpoints (PaginationQueryDto @Max(100)). */
export const MAX_PAGE_LIMIT = 100;

/**
 * Fetch every page of a paginated list endpoint and return the flattened rows.
 * Use instead of a large `?limit=`, which the API rejects with a 400.
 */
export async function fetchAllPages<T>(basePath: string): Promise<T[]> {
  const separator = basePath.includes("?") ? "&" : "?";
  const rows: T[] = [];
  const maxPages = 1000;
  for (let page = 1; page <= maxPages; page++) {
    const res = await apiFetch<PaginatedResponse<T>>(
      `${basePath}${separator}page=${page}&limit=${MAX_PAGE_LIMIT}`,
    );
    rows.push(...res.data);
    if (!res.data.length || page >= (res.meta?.totalPages ?? 1)) break;
  }
  return rows;
}

/**
 * After authentication, sets the active org and returns the redirect path
 * based on the user's role (owner/admin -> /dashboard, member -> /portal).
 *
 * `preferredOrgId` is used when the caller knows which org the user is acting
 * on (e.g. the org they just accepted an invite to). Otherwise the session's
 * own active org is used — the API stamps one deterministically at session
 * creation (see AuthService.getPreferredActiveOrgForUserId). `orgs[0]` is the
 * last resort only, because the list is unordered.
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

  let sessionOrgId: string | undefined;
  try {
    const sessionRes = await fetch(`${API_URL}/api/auth/get-session`, {
      credentials: "include",
    });
    if (sessionRes.ok) {
      const session = await sessionRes.json();
      sessionOrgId = session?.session?.activeOrganizationId ?? undefined;
    }
  } catch (err) {
    console.error("Failed to read session active org", err);
  }

  const isMember = (id?: string): id is string =>
    !!id && orgs.some((o) => o.id === id);

  const targetOrgId = isMember(preferredOrgId)
    ? preferredOrgId
    : isMember(sessionOrgId)
      ? sessionOrgId
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
