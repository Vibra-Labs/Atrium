import { describe, expect, it } from "bun:test";
import { daysLate, stagesFor, webLink } from "./pursuit";
import type { Pipeline } from "./pursuit";

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
  const stage = (id: string, order: number) => ({ id, name: id, slug: id, order });
  const pipelines: Pipeline[] = [
    { id: "com", name: "Commercial", order: 0, stages: [stage("c2", 1), stage("c1", 0)] },
    { id: "gov", name: "Government", order: 1, stages: [stage("g1", 0)] },
  ];

  it("gives the contract's pipeline's stages in order", () => {
    expect(stagesFor(pipelines, "com").map((s) => s.id)).toEqual(["c1", "c2"]);
    expect(stagesFor(pipelines, "gov").map((s) => s.id)).toEqual(["g1"]);
  });

  it("uses the first pipeline for an unassigned contract", () => {
    expect(stagesFor(pipelines, null).map((s) => s.id)).toEqual(["c1", "c2"]);
  });

  it("is empty while pipelines load", () => {
    expect(stagesFor(null, "com")).toEqual([]);
  });
});
