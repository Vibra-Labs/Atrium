import { describe, expect, it } from "bun:test";
import { trialDaysLeft } from "./plan-features";

describe("trialDaysLeft", () => {
  const now = new Date("2026-10-08T12:00:00Z");

  it("rounds partial days up", () => {
    expect(trialDaysLeft(new Date("2026-10-22T12:00:00Z"), now)).toBe(14);
    expect(trialDaysLeft(new Date("2026-10-08T13:00:00Z"), now)).toBe(1);
  });

  it("never goes negative", () => {
    expect(trialDaysLeft(new Date("2026-10-01T00:00:00Z"), now)).toBe(0);
  });
});
