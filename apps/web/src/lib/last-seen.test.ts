import { describe, expect, it } from "bun:test";
import { formatLastSeen } from "./last-seen";

const NOW = new Date("2026-10-14T12:00:00Z");
const HOUR_MS = 60 * 60 * 1000;

describe("formatLastSeen", () => {
  it("says no visit is recorded when there is no timestamp", () => {
    expect(formatLastSeen(null, NOW)).toBe("No visits recorded yet");
  });

  it("says active today within the last 24 hours", () => {
    expect(formatLastSeen(new Date(NOW.getTime() - 3 * HOUR_MS).toISOString(), NOW)).toBe("Active today");
  });

  it("says yesterday for one day ago", () => {
    expect(formatLastSeen(new Date(NOW.getTime() - 30 * HOUR_MS).toISOString(), NOW)).toBe("Last seen yesterday");
  });

  it("counts days for older visits", () => {
    expect(formatLastSeen(new Date(NOW.getTime() - 5 * 24 * HOUR_MS).toISOString(), NOW)).toBe("Last seen 5 days ago");
  });
});
