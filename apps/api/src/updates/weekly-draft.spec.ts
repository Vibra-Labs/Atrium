import { describe, expect, it } from "bun:test";
import { buildWeeklyDraft } from "./weekly-draft";

describe("buildWeeklyDraft", () => {
  it("lists completed work, shared files and what's next", () => {
    const draft = buildWeeklyDraft({
      projectName: "Living Unlimited",
      completedTasks: ["Homepage design", "Brand colours"],
      newFiles: ["homepage-v2.pdf"],
      upcomingTasks: ["About page", "Contact form"],
    });
    expect(draft).toBe(
      [
        "Here's where Living Unlimited stands this week.",
        "",
        "Done this week:",
        "- Homepage design",
        "- Brand colours",
        "",
        "New files:",
        "- homepage-v2.pdf",
        "",
        "Up next:",
        "- About page",
        "- Contact form",
      ].join("\n"),
    );
  });

  it("leaves out empty sections", () => {
    const draft = buildWeeklyDraft({
      projectName: "Site",
      completedTasks: ["Launch"],
      newFiles: [],
      upcomingTasks: [],
    });
    expect(draft).not.toContain("New files:");
    expect(draft).not.toContain("Up next:");
  });

  it("gives the owner a prompt to fill in when nothing was recorded", () => {
    const draft = buildWeeklyDraft({ projectName: "Site", completedTasks: [], newFiles: [], upcomingTasks: [] });
    expect(draft).toContain("Here's where Site stands this week.");
    expect(draft).toContain("[What moved forward this week?]");
  });

  it("caps long lists so the email stays readable", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => `Task ${i + 1}`);
    const draft = buildWeeklyDraft({ projectName: "Site", completedTasks: tasks, newFiles: [], upcomingTasks: [] });
    expect(draft).toContain("- Task 8");
    expect(draft).not.toContain("- Task 9");
    expect(draft).toContain("- and 4 more");
  });
});
