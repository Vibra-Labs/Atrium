import { describe, expect, it } from "bun:test";
import { isBuiltInStatus, statusColor, statusLabel } from "./project-status";

const statuses = [
  { id: "1", name: "Delivered", slug: "completed", order: 3, color: "#10b981" },
  { id: "2", name: "Design", slug: "design", order: 1, color: "#8b5cf6" },
];

describe("project status helpers", () => {
  it("name a status by the workspace's own name, even after a rename", () => {
    expect(statusLabel(statuses, "completed")).toBe("Delivered");
    expect(statusLabel(statuses, "design")).toBe("Design");
  });

  it("fall back to a readable slug while statuses load or for an unknown one", () => {
    expect(statusLabel(null, "in_progress")).toBe("in progress");
    expect(statusLabel(statuses, "on_hold")).toBe("on hold");
  });

  it("give the status color, grey when unknown", () => {
    expect(statusColor(statuses, "design")).toBe("#8b5cf6");
    expect(statusColor(statuses, "nope")).toBe("#6b7280");
  });

  it("know the built-in statuses, which can't be deleted", () => {
    expect(isBuiltInStatus("completed")).toBe(true);
    expect(isBuiltInStatus("design")).toBe(false);
  });
});
