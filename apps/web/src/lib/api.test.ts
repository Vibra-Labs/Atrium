import { describe, expect, it, mock, afterEach } from "bun:test";
import { fetchAllPages, MAX_PAGE_LIMIT } from "./api";

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
