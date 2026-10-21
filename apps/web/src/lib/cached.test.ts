import { afterEach, describe, expect, it, mock } from "bun:test";
import { clearCached, invalidate, loadCached } from "./cached";

afterEach(() => clearCached());

describe("cached reference data", () => {
  it("shares one request between concurrent callers and then serves the cache", async () => {
    const fetcher = mock(async (): Promise<string[]> => ["a"]);
    const [x, y] = await Promise.all([loadCached("k", fetcher), loadCached("k", fetcher)]);
    expect(x).toEqual(["a"]);
    expect(y).toBe(x);
    await loadCached("k", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches after invalidate", async () => {
    let n = 0;
    const fetcher = async (): Promise<number> => ++n;
    expect(await loadCached("k", fetcher)).toBe(1);
    invalidate("k");
    expect(await loadCached("k", fetcher)).toBe(2);
  });

  it("refetches data older than maxAgeMs", async () => {
    let n = 0;
    const fetcher = async (): Promise<number> => ++n;
    expect(await loadCached("k", fetcher, 60_000)).toBe(1);
    expect(await loadCached("k", fetcher, 60_000)).toBe(1);
    await new Promise((r) => setTimeout(r, 5));
    expect(await loadCached("k", fetcher, 1)).toBe(2);
  });

  it("refetches after clear (workspace switch)", async () => {
    let n = 0;
    const fetcher = async (): Promise<number> => ++n;
    await loadCached("k", fetcher);
    clearCached();
    expect(await loadCached("k", fetcher)).toBe(2);
  });

  it("ignores a response that lands after the workspace changed", async () => {
    let resolve: (v: string) => void = () => {};
    const slow = new Promise<string>((r) => (resolve = r));
    const first = loadCached("k", () => slow);
    clearCached();
    resolve("old");
    await first;
    expect(await loadCached("k", async () => "new")).toBe("new");
  });

  it("does not cache failures", async () => {
    const original = console.error;
    console.error = mock(() => {});
    try {
      expect(await loadCached("k", () => Promise.reject(new Error("x")))).toBeNull();
    } finally {
      console.error = original;
    }
    expect(await loadCached("k", async () => "ok")).toBe("ok");
  });
});
