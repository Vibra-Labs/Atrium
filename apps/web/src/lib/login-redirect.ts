import { headers } from "next/headers";

/** /login, carrying the page a signed-out visitor asked for so sign-in can return them there. */
export async function loginRedirectPath(): Promise<string> {
  const path: string | null = (await headers()).get("x-pathname");
  return path ? `/login?next=${encodeURIComponent(path)}` : "/login";
}
