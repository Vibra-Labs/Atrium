import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { APIRequestContext, BrowserContext } from "@playwright/test";

const API = "http://localhost:3001/api";

/**
 * Read the CSRF token from the stored auth state file written by global-setup.
 * This is used by tests that make API calls via the `request` fixture (which
 * carries cookies from stored state but does NOT automatically set the
 * x-csrf-token header).
 */
export function getCsrfToken(): string {
  // The global-setup writes to "e2e/.auth/user.json" (relative to repo root).
  // Depending on cwd, the file could be at either of these paths.
  const candidates = [
    resolve(__dirname, "../.auth/user.json"),
    resolve(__dirname, "../e2e/.auth/user.json"),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      const state = JSON.parse(readFileSync(p, "utf-8"));
      const cookie = state.cookies?.find(
        (c: { name: string }) => c.name === "csrf-token",
      );
      return cookie?.value || "";
    }
  }

  return "";
}

/**
 * Read the CSRF token from a live browser context's cookies.
 * Use this for tests that create fresh contexts (e.g. browser.newContext())
 * where the stored auth state is not applicable.
 */
export async function getCsrfTokenFromContext(
  context: BrowserContext,
): Promise<string> {
  const cookies = await context.cookies();
  const cookie = cookies.find((c) => c.name === "csrf-token");
  return cookie?.value || "";
}

/**
 * Get or create a project by name. The Free plan caps orgs at 2 projects, so
 * tests must reuse projects by name when possible.
 */
export async function getOrCreateProject(
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const listRes = await request.get(`${API}/projects?limit=100`);
  if (listRes.ok()) {
    const list = await listRes.json();
    const items: { id: string; name: string }[] = Array.isArray(list)
      ? list
      : (list.data ?? []);
    const found = items.find((p) => p.name === name);
    if (found) return found.id;
  }
  const csrfToken = getCsrfToken();
  const res = await request.post(`${API}/projects`, {
    data: { name },
    headers: { "x-csrf-token": csrfToken },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `Failed to create project (${res.status()}): ${body.slice(0, 200)}`,
    );
  }
  const body = await res.json();
  return body.id as string;
}

export async function createTask(
  request: APIRequestContext,
  projectId: string,
  title: string,
  dueDate: Date,
): Promise<string> {
  const csrfToken = getCsrfToken();
  const res = await request.post(`${API}/tasks?projectId=${projectId}`, {
    data: { title, dueDate: dueDate.toISOString() },
    headers: { "x-csrf-token": csrfToken },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `Failed to create task (${res.status()}): ${body.slice(0, 200)}`,
    );
  }
  const body = await res.json();
  return body.id as string;
}
