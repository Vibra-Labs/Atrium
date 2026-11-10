import { describe, expect, it } from "bun:test";
import { daysLate, webLink } from "./pursuit";

describe("daysLate", () => {
  it("says how many days past due", () => {
    expect(daysLate("2026-11-05", "2026-11-08")).toBe("3 days late");
  });
  it("uses the singular for one day", () => {
    expect(daysLate("2026-11-07T00:00:00.000Z", "2026-11-08")).toBe("1 day late");
  });
});

describe("webLink", () => {
  it("keeps http and https links", () => {
    expect(webLink("https://sam.gov/opp/1")).toBe("https://sam.gov/opp/1");
    expect(webLink("HTTP://example.com")).toBe("HTTP://example.com");
  });

  it("drops anything else, so it never becomes a clickable script", () => {
    expect(webLink("javascript:alert(1)")).toBeNull();
    expect(webLink(" javascript:alert(1)")).toBeNull();
    expect(webLink("data:text/html,hi")).toBeNull();
    expect(webLink(null)).toBeNull();
  });
});
