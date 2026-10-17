import "server-only";
import { cookies, headers } from "next/headers";
import { forwardHeaders, resolveInternalApiUrl } from "./internal-api-url";

/** Resolved per call, not at import: `next build` loads this module without it set. */
export function internalApiUrl(): string {
  return resolveInternalApiUrl(process.env);
}

/** Calls the API from a server component as the visiting user. */
export async function serverFetch(path: string): Promise<Response> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return fetch(`${internalApiUrl()}${path}`, {
    headers: forwardHeaders(cookieStore.toString(), headerStore.get("x-forwarded-for")),
    cache: "no-store",
  });
}
