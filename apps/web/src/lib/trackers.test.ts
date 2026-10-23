import { describe, expect, it } from "bun:test";
import { getTrackers, trackersDeprecationWarning } from "./trackers";

const UMAMI: string =
  '[{"src":"https://umami.example.com/script.js","data-website-id":"abc"}]';

describe("getTrackers", () => {
  it("returns nothing when neither variable is set", () => {
    expect(getTrackers({})).toEqual([]);
  });

  it("reads ATRIUM_TRACKERS", () => {
    expect(getTrackers({ ATRIUM_TRACKERS: UMAMI })).toEqual([
      {
        src: "https://umami.example.com/script.js",
        "data-website-id": "abc",
        "data-before-send": "atriumMaskAnalyticsEvent",
      },
    ]);
  });

  it("falls back to NEXT_PUBLIC_TRACKERS", () => {
    expect(getTrackers({ NEXT_PUBLIC_TRACKERS: UMAMI })).toHaveLength(1);
  });

  it("prefers ATRIUM_TRACKERS over NEXT_PUBLIC_TRACKERS", () => {
    const other: string = '[{"src":"https://other.example.com/a.js"}]';
    const [tracker] = getTrackers({ ATRIUM_TRACKERS: UMAMI, NEXT_PUBLIC_TRACKERS: other });
    expect(tracker.src).toBe("https://umami.example.com/script.js");
  });

  it("falls back when ATRIUM_TRACKERS is empty", () => {
    expect(getTrackers({ ATRIUM_TRACKERS: "", NEXT_PUBLIC_TRACKERS: UMAMI })).toHaveLength(1);
  });

  it("drops attributes outside the whitelist", () => {
    const raw: string =
      '[{"src":"https://a.example.com/s.js","onload":"alert(1)","data-x":"1","async":"true"}]';
    expect(getTrackers({ ATRIUM_TRACKERS: raw })[0]).toEqual({
      src: "https://a.example.com/s.js",
      "data-x": "1",
      async: "true",
      "data-before-send": "atriumMaskAnalyticsEvent",
    });
  });

  it("keeps an operator's own data-before-send", () => {
    const raw: string = '[{"src":"https://a.example.com/s.js","data-before-send":"mine"}]';
    expect(getTrackers({ ATRIUM_TRACKERS: raw })[0]["data-before-send"]).toBe("mine");
  });

  it("ignores entries without a src, non-arrays and invalid JSON", () => {
    expect(getTrackers({ ATRIUM_TRACKERS: '[{"data-x":"1"}, null, 3]' })).toEqual([]);
    expect(getTrackers({ ATRIUM_TRACKERS: '{"src":"https://a.example.com"}' })).toEqual([]);
    expect(getTrackers({ ATRIUM_TRACKERS: "not json" })).toEqual([]);
  });
});

describe("trackersDeprecationWarning", () => {
  it("warns when only NEXT_PUBLIC_TRACKERS is set", () => {
    expect(trackersDeprecationWarning({ NEXT_PUBLIC_TRACKERS: UMAMI })).toContain("ATRIUM_TRACKERS");
  });

  it("is silent when ATRIUM_TRACKERS is set or neither is", () => {
    expect(trackersDeprecationWarning({ ATRIUM_TRACKERS: UMAMI, NEXT_PUBLIC_TRACKERS: UMAMI })).toBeNull();
    expect(trackersDeprecationWarning({})).toBeNull();
  });
});
