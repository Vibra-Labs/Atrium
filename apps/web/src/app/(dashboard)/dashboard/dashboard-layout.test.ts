import { describe, expect, it } from "bun:test";
import { toggleHidden } from "./dashboard-layout";

describe("toggleHidden", () => {
  it("hides a visible card", () => {
    expect(toggleHidden(["stats"], "pipeline")).toEqual(["stats", "pipeline"]);
  });

  it("shows a hidden card again", () => {
    expect(toggleHidden(["stats", "pipeline"], "stats")).toEqual(["pipeline"]);
  });
});
