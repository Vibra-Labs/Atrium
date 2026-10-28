import { describe, expect, it } from "bun:test";
import { projectProgress } from "./progress";

describe("projectProgress", () => {
  it("uses the task counts from the project list", () => {
    expect(projectProgress({ status: "in_progress", taskCount: 4, completedTaskCount: 3 })).toBe(75);
  });

  it("is 100 for a completed project", () => {
    expect(projectProgress({ status: "completed", taskCount: 4, completedTaskCount: 1 })).toBe(100);
  });

  it("is 0 with no tasks", () => {
    expect(projectProgress({ status: "in_progress", taskCount: 0, completedTaskCount: 0 })).toBe(0);
    expect(projectProgress({ status: "in_progress" })).toBe(0);
  });
});
