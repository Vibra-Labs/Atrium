import { describe, expect, it } from "bun:test";
import { RateLimiter } from "./rate-limiter";

describe("RateLimiter", () => {
  it("allows up to the limit within the window, then blocks", () => {
    const limiter = new RateLimiter(300, 60_000);
    for (let i = 0; i < 300; i++) expect(limiter.allow("k1", 1_000)).toBe(true);
    expect(limiter.allow("k1", 1_000)).toBe(false);
  });

  it("tracks keys independently", () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("b", 0)).toBe(true);
    expect(limiter.allow("a", 0)).toBe(false);
  });

  it("frees capacity once the window slides past old requests", () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 59_999)).toBe(false);
    expect(limiter.allow("a", 60_001)).toBe(true);
  });
});
