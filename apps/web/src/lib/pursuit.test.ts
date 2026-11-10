import { describe, expect, it } from "bun:test";
import { daysLate, stagesFor, webLink } from "./pursuit";
import type { PipelineStage } from "./pursuit";

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

describe("stagesFor", () => {
  const stage = (id: string, pipeline: "bid" | "commercial", order: number): PipelineStage => ({
    id,
    pipeline,
    name: id,
    slug: id,
    order,
  });

  it("gives the contract's pipeline in order", () => {
    const all: PipelineStage[] = [stage("c2", "commercial", 1), stage("b1", "bid", 0), stage("c1", "commercial", 0)];
    expect(stagesFor(all, false).map((s) => s.id)).toEqual(["c1", "c2"]);
    expect(stagesFor(all, true).map((s) => s.id)).toEqual(["b1"]);
  });

  it("is empty while stages load", () => {
    expect(stagesFor(null, false)).toEqual([]);
  });
});
