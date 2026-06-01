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

/**
 * Canonical shape returned by every paginated list endpoint
 * (see apps/api/src/common/helpers/paginate.ts -> paginatedResponse).
 */
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Maximum `limit` the API accepts on paginated list endpoints
 * (PaginationQueryDto enforces @Max(100)). Requesting more returns a 400.
 */
export const MAX_PAGE_LIMIT = 100;

/**
 * Fetch EVERY page of a paginated list endpoint and return the flattened rows.
 *
 * Use this instead of guessing a large `limit` (e.g. `?limit=200`, which the
 * API rejects with 400 "limit must not be greater than 100"). It walks pages
 * at the API maximum until all `meta.total` rows are collected, so it stays
 * correct no matter how many records exist and never silently truncates.
 *
 * @param basePath  Endpoint path WITHOUT page/limit params, e.g.
 *                  "/billing-clients" or "/projects?archived=false".
 *                  Existing query strings are preserved.
 * @param pageLimit Per-request page size (defaults to the API max of 100).
 */
export async function fetchAllPages<T>(
  basePath: string,
  pageLimit: number = MAX_PAGE_LIMIT,
): Promise<T[]> {
  const limit = Math.min(Math.max(1, pageLimit), MAX_PAGE_LIMIT);
  const separator = basePath.includes("?") ? "&" : "?";
  const rows: T[] = [];
  let page = 1;
  // Hard safety ceiling: prevents an infinite loop if the API ever returns
  // malformed meta (e.g. totalPages that never converges).
  const MAX_PAGES = 1000;

  while (page <= MAX_PAGES) {
    const res = await apiFetch<PaginatedResponse<T>>(
      `${basePath}${separator}page=${page}&limit=${limit}`,
    );
    rows.push(...res.data);

    const totalPages = res.meta?.totalPages ?? 1;
    if (!res.data.length || page >= totalPages) break;
    page += 1;
  }

  return rows;
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
