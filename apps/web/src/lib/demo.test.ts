import { describe, expect, it } from "bun:test";
import { uploadDisabledReason, DEMO_UPLOADS_OFF, resetCountdown } from "./demo";

describe("uploadDisabledReason", () => {
  it("is null outside the demo, so uploads work normally", () => {
    expect(uploadDisabledReason(false)).toBeNull();
    expect(uploadDisabledReason(undefined)).toBeNull();
  });

  it("explains why uploads are off in the demo, in the API's own words", () => {
    expect(uploadDisabledReason(true)).toBe(DEMO_UPLOADS_OFF);
    expect(uploadDisabledReason(true)).toBe("Uploads are turned off in the demo.");
  });
});

describe("resetCountdown", () => {
  // The reset cron runs on the half hour, so the next one is always the next
  // :00 or :30. Computed from the clock rather than fetched: it costs no round
  // trip, and if a reset is skipped because someone is mid-click the countdown
  // simply rolls to the following slot.
  const at = (h: number, m: number, s = 0): Date => new Date(2026, 10, 17, h, m, s);

  it("counts down to the next half hour", () => {
    expect(resetCountdown(at(14, 18))).toBe("in 12 minutes");
    expect(resetCountdown(at(14, 48))).toBe("in 12 minutes");
  });

  it("says a minute without the plural", () => {
    expect(resetCountdown(at(14, 29))).toBe("in 1 minute");
  });

  it("does not promise a reset is imminent in the final seconds", () => {
    // "in 0 minutes" reads as broken, and the reset may be held off anyway.
    expect(resetCountdown(at(14, 29, 50))).toBe("in under a minute");
    expect(resetCountdown(at(14, 59, 59))).toBe("in under a minute");
  });

  it("is at most half an hour away, whatever the clock says", () => {
    for (let minute = 0; minute < 60; minute += 7) {
      const text: string = resetCountdown(at(9, minute));
      const value: number = Number(text.replace(/\D/g, "")) || 0;
      expect(value).toBeLessThanOrEqual(30);
    }
  });
});
