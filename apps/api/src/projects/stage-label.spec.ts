import { describe, expect, it } from "bun:test";
import { stageLabel } from "@atrium/shared";

const stages = [
  { pipeline: "commercial", slug: "found", name: "Intro call" },
  { pipeline: "bid", slug: "found", name: "Identified" },
];

describe("stageLabel", () => {
  it("names the stage from the contract's pipeline", () => {
    expect(stageLabel(stages, false, "found")).toBe("Intro call");
    expect(stageLabel(stages, true, "found")).toBe("Identified");
  });

  it("falls back to the slug when the stage is unknown", () => {
    expect(stageLabel(stages, true, "gone")).toBe("gone");
    expect(stageLabel(null, false, "found")).toBe("found");
  });
});
