import { describe, expect, it } from "bun:test";
import { isValidTimeZone, localClock, hasReachedLocalTime } from "./local-time";

// Friday 2026-10-09 13:00 UTC
const FRI_13_UTC = new Date("2026-10-09T13:00:00Z");

describe("isValidTimeZone", () => {
  it("accepts IANA names and rejects anything else", () => {
    expect(isValidTimeZone("Australia/Sydney")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("localClock", () => {
  it("reports the weekday and hour in the given zone", () => {
    expect(localClock(FRI_13_UTC, "UTC")).toEqual({ weekday: 5, hour: 13 });
    expect(localClock(FRI_13_UTC, "America/Los_Angeles")).toEqual({ weekday: 5, hour: 6 });
    // Already Saturday in Sydney (UTC+11 in October).
    expect(localClock(FRI_13_UTC, "Australia/Sydney")).toEqual({ weekday: 6, hour: 0 });
  });

  it("falls back to UTC for a missing or invalid zone", () => {
    expect(localClock(FRI_13_UTC, null)).toEqual({ weekday: 5, hour: 13 });
    expect(localClock(FRI_13_UTC, "Mars/Olympus")).toEqual({ weekday: 5, hour: 13 });
  });
});

describe("hasReachedLocalTime", () => {
  it("is true from the target hour onwards on the target weekday, in local time", () => {
    expect(hasReachedLocalTime(FRI_13_UTC, "UTC", 5, 13)).toBe(true);
    expect(hasReachedLocalTime(FRI_13_UTC, "UTC", 5, 14)).toBe(false);
    expect(hasReachedLocalTime(FRI_13_UTC, "America/Los_Angeles", 5, 13)).toBe(false);
    expect(hasReachedLocalTime(new Date("2026-10-09T20:00:00Z"), "America/Los_Angeles", 5, 13)).toBe(true);
    expect(hasReachedLocalTime(FRI_13_UTC, "Australia/Sydney", 5, 13)).toBe(false);
    expect(hasReachedLocalTime(new Date("2026-10-09T02:30:00Z"), "Australia/Sydney", 5, 13)).toBe(true);
  });
});
