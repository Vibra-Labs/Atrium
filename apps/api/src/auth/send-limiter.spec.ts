import { describe, expect, it } from "bun:test";
import { SendLimiter } from "./send-limiter";

describe("SendLimiter", () => {
  it("allows up to the limit per key, then refuses until the window passes", () => {
    const limiter = new SendLimiter(2, 1000);

    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 10)).toBe(true);
    expect(limiter.allow("a", 20)).toBe(false);
    expect(limiter.allow("b", 20)).toBe(true);
    expect(limiter.allow("a", 1001)).toBe(true);
  });
});
