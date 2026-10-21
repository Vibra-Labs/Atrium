import { describe, expect, it, mock, afterEach } from "bun:test";
import { ApiError, apiFetch, fetchAllPages, MAX_PAGE_LIMIT, setActiveOrgAndRedirect } from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockPages(pages: Record<number, unknown[]>, total: number): string[] {
  const calls: string[] = [];
  const totalPages = Math.ceil(total / MAX_PAGE_LIMIT);
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    const page = Number(new URL(u, "http://localhost").searchParams.get("page"));
    const body = {
      data: pages[page] ?? [],
      meta: { total, page, limit: MAX_PAGE_LIMIT, totalPages },
    };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return calls;
}

describe("fetchAllPages", () => {
  it("never requests more than the API max per page", async () => {
    const calls = mockPages({ 1: [{ id: 1 }] }, 1);
    await fetchAllPages("/projects");
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0], "http://localhost").searchParams.get("limit")).toBe(String(MAX_PAGE_LIMIT));
  });

  it("walks every page and flattens rows", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const page2 = [{ id: 100 }, { id: 101 }];
    const calls = mockPages({ 1: page1, 2: page2 }, 102);
    const rows = await fetchAllPages<{ id: number }>("/projects");
    expect(rows).toHaveLength(102);
    expect(rows[101].id).toBe(101);
    expect(calls).toHaveLength(2);
  });

  it("preserves an existing query string", async () => {
    const calls = mockPages({ 1: [] }, 0);
    await fetchAllPages("/projects?archived=false");
    const u = new URL(calls[0], "http://localhost");
    expect(u.searchParams.get("archived")).toBe("false");
    expect(u.searchParams.get("page")).toBe("1");
  });
});

function mockAuth(opts: { orgs: string[]; sessionOrg: string | null; role: string }): string[] {
  const calls: string[] = [];
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    const path = new URL(String(url), "http://localhost").pathname;
    calls.push(path);
    if (path.endsWith("/organization/list")) {
      return new Response(JSON.stringify(opts.orgs.map((id) => ({ id }))), { status: 200 });
    }
    if (path.endsWith("/get-session")) {
      return new Response(
        JSON.stringify({ session: { activeOrganizationId: opts.sessionOrg } }),
        { status: 200 },
      );
    }
    if (path.endsWith("/get-active-member")) {
      return new Response(JSON.stringify({ role: opts.role }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return calls;
}

describe("setActiveOrgAndRedirect", () => {
  it("skips set-active when the session already has the target org", async () => {
    const calls = mockAuth({ orgs: ["a", "b"], sessionOrg: "b", role: "owner" });
    const path = await setActiveOrgAndRedirect("/portal/projects");
    expect(path).toBe("/dashboard");
    expect(calls.some((c) => c.endsWith("/set-active"))).toBe(false);
  });

  it("sets the preferred org when it differs from the session's", async () => {
    const calls = mockAuth({ orgs: ["a", "b"], sessionOrg: "a", role: "member" });
    const path = await setActiveOrgAndRedirect("/portal/projects", "b");
    expect(path).toBe("/portal/projects");
    expect(calls.filter((c) => c.endsWith("/set-active"))).toHaveLength(1);
  });

  it("falls back to the first org and sets it when the session has none", async () => {
    const calls = mockAuth({ orgs: ["a"], sessionOrg: null, role: "admin" });
    expect(await setActiveOrgAndRedirect()).toBe("/dashboard");
    expect(calls.some((c) => c.endsWith("/set-active"))).toBe(true);
  });
});

describe("apiFetch errors", () => {
  it("throws an ApiError carrying the HTTP status", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ message: "No active organization" }), { status: 401 }),
    ) as unknown as typeof fetch;
    const err: unknown = await apiFetch("/organization/current").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).message).toBe("No active organization");
  });
});
