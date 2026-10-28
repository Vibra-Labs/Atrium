import { describe, expect, it } from "bun:test";
import { projectPhases } from "./phases";

const s = (slug: string, order: number) => ({ slug, name: slug, order });

describe("projectPhases", () => {
  it("lists every status in order except cancelled", () => {
    const statuses = [s("done", 4), s("a", 0), s("b", 1), s("c", 2), s("d", 3), s("cancelled", 5)];
    const { phases } = projectPhases(statuses, "a");
    expect(phases.map((p) => p.key)).toEqual(["a", "b", "c", "d", "done"]);
  });

  it("marks the project's status as current", () => {
    expect(projectPhases([s("a", 0), s("b", 1)], "b").currentIndex).toBe(1);
  });

  it("marks nothing current when the status is off the track", () => {
    expect(projectPhases([s("a", 0), s("b", 1)], "cancelled").currentIndex).toBe(-1);
  });

  it("falls back to the default statuses before they load", () => {
    const { phases, currentIndex } = projectPhases([], "in_review");
    expect(phases.map((p) => p.key)).toEqual(["not_started", "in_progress", "in_review", "completed"]);
    expect(currentIndex).toBe(2);
  });
});
