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

describe("RateLimiter.isLimited", () => {
  it("reports whether a key is limited without recording a hit", () => {
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.isLimited("a", 0)).toBe(false);
    expect(limiter.isLimited("a", 0)).toBe(false);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.isLimited("a", 0)).toBe(true);
    // The window sliding past the recorded hits clears the limit.
    expect(limiter.isLimited("a", 60_001)).toBe(false);
  });
});

describe("RateLimiter key hygiene", () => {
  it("truncates keys to 64 characters so spoofed values cannot fan out", () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.allow("x".repeat(64) + "tail-a", 0)).toBe(true);
    expect(limiter.allow("x".repeat(64) + "tail-b", 0)).toBe(false);
    expect(limiter.isLimited("x".repeat(64), 0)).toBe(true);
  });

  it("refuses new keys once the cap is reached, while existing keys keep working", () => {
    const limiter = new RateLimiter(5, 60_000, 2);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("b", 0)).toBe(true);

    expect(limiter.allow("c", 30_000)).toBe(false);
    expect(limiter.isLimited("c", 30_000)).toBe(true);
    expect(limiter.allow("a", 30_000)).toBe(true);
  });

  it("sweeps expired keys at most once per window", () => {
    const limiter = new RateLimiter(5, 60_000, 2);
    limiter.allow("a", 0);
    limiter.allow("b", 0);

    // First sweep runs here and frees nothing: a and b are still in the window.
    expect(limiter.allow("c", 30_000)).toBe(false);

    // a and b have now expired, but the next sweep is not due yet.
    expect(limiter.allow("c", 61_000)).toBe(false);

    // A full window after the last sweep, the expired keys are reclaimed.
    expect(limiter.allow("c", 91_000)).toBe(true);
  });
});

describe("RateLimiter fail-open at capacity", () => {
  it("admits unknown keys without tracking them once the map is full", () => {
    const limiter = new RateLimiter(1, 60_000, 2, false);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("b", 0)).toBe(true);

    // An unknown key arriving at capacity is neither limited nor recorded.
    for (let i = 0; i < 3; i++) {
      expect(limiter.isLimited("c", 30_000)).toBe(false);
      expect(limiter.allow("c", 30_000)).toBe(true);
    }

    // The two known keys still own the map, so "c" never displaced them.
    expect(limiter.isLimited("a", 30_000)).toBe(true);
    expect(limiter.isLimited("b", 30_000)).toBe(true);

    // Once a and b expire and a sweep is due, a new key is tracked again.
    expect(limiter.allow("c", 91_000)).toBe(true);
    expect(limiter.allow("c", 91_000)).toBe(false);
  });

  it("still limits known keys while failing open for unknown ones", () => {
    const limiter = new RateLimiter(1, 60_000, 2, false);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("b", 0)).toBe(true);
    expect(limiter.allow("a", 0)).toBe(false);
    expect(limiter.isLimited("a", 0)).toBe(true);
    expect(limiter.allow("z", 0)).toBe(true);
  });
});
