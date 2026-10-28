import { describe, expect, it } from "bun:test";
import type { CalendarEvent } from "@atrium/shared";
import { thisWeekItems, thisWeekRange } from "./this-week";

const task = (id: string, date: string, status = "todo"): CalendarEvent => ({
  type: "task", id, date, title: id, status, projectId: "p", projectName: "P", assigneeId: null, assigneeName: null,
});

describe("thisWeekRange", () => {
  it("covers today and the next six days", () => {
    expect(thisWeekRange(new Date(2026, 9, 28))).toEqual({ from: "2026-10-28", to: "2026-11-03" });
  });
});

describe("thisWeekItems", () => {
  it("drops finished work and project start dates, sorted by date", () => {
    const events: CalendarEvent[] = [
      task("later", "2026-10-30"),
      task("done", "2026-10-28", "done"),
      { type: "project_start", id: "s", date: "2026-10-28", title: "Start", projectId: "p", projectName: "P" },
      { type: "project_end", id: "e", date: "2026-10-29", title: "Launch", projectId: "p", projectName: "P" },
      { type: "invoice_due", id: "paid", date: "2026-10-28", title: "INV-1", status: "paid", projectId: null, projectName: null, amountCents: 100 },
      { type: "invoice_due", id: "due", date: "2026-10-28", title: "INV-2", status: "sent", projectId: null, projectName: null, amountCents: 100 },
    ];
    expect(thisWeekItems(events).map((e) => e.id)).toEqual(["due", "e", "later"]);
  });

  it("caps the list", () => {
    const events = Array.from({ length: 10 }, (_, i) => task(`t${i}`, "2026-10-29"));
    expect(thisWeekItems(events, 6)).toHaveLength(6);
  });
});
