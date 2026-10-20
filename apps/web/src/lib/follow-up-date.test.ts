import { describe, expect, it } from "bun:test";
import { followUpDay, followUpWhen, formatFollowUpDay, localToday } from "./follow-up-date";

describe("follow-up dates", () => {
  it("followUpDay takes the stored value's UTC date", () => {
    expect(followUpDay("2026-11-19T12:00:00.000Z")).toBe("2026-11-19");
    // A legacy local-midnight value east of UTC still reads as its UTC date.
    expect(followUpDay("2026-11-18T23:00:00.000Z")).toBe("2026-11-18");
    expect(followUpDay(null)).toBe("");
  });

  it("localToday is the local calendar date", () => {
    const d = new Date(2026, 0, 5, 23, 30); // Jan 5, 23:30 local
    expect(localToday(d)).toBe("2026-01-05");
  });

  it("followUpWhen compares the follow-up date with local today", () => {
    const now = new Date(2026, 9, 20, 22, 0); // Oct 20 local evening
    expect(followUpWhen("2026-10-20T12:00:00.000Z", now)).toBe("today");
    expect(followUpWhen("2026-10-19T12:00:00.000Z", now)).toBe("overdue");
    expect(followUpWhen("2026-10-21T12:00:00.000Z", now)).toBe("upcoming");
  });

  it("formatFollowUpDay shows the UTC date regardless of local zone", () => {
    expect(formatFollowUpDay("2026-11-19T12:00:00.000Z")).toBe("Nov 19");
  });
});
