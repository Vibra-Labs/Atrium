import { describe, expect, it } from "bun:test";
import { pipelineFor, stageLabel } from "@atrium/shared";

const pipelines = [
  { id: "com", name: "Commercial", stages: [{ slug: "found", name: "Intro call" }] },
  { id: "gov", name: "Government", stages: [{ slug: "found", name: "Identified" }] },
];

describe("stageLabel", () => {
  it("names the stage from the contract's pipeline", () => {
    expect(stageLabel(pipelines, "com", "found")).toBe("Intro call");
    expect(stageLabel(pipelines, "gov", "found")).toBe("Identified");
  });

  it("uses the first pipeline for an unassigned contract", () => {
    expect(stageLabel(pipelines, null, "found")).toBe("Intro call");
    expect(pipelineFor(pipelines, null)?.name).toBe("Commercial");
  });

  it("falls back to the slug when the stage is unknown", () => {
    expect(stageLabel(pipelines, "gov", "gone")).toBe("gone");
    expect(stageLabel(null, "com", "found")).toBe("found");
  });
});
