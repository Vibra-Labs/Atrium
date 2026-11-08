import { describe, expect, it } from "bun:test";
import { daysLate } from "./pursuit";

describe("daysLate", () => {
  it("says how many days past due", () => {
    expect(daysLate("2026-11-05", "2026-11-08")).toBe("3 days late");
  });
  it("uses the singular for one day", () => {
    expect(daysLate("2026-11-07T00:00:00.000Z", "2026-11-08")).toBe("1 day late");
  });
});
