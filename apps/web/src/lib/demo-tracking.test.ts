import { describe, expect, it, beforeEach } from "bun:test";
import {
  DEMO_ACTED_EVENT,
  DEMO_CTA_EVENT,
  DEMO_ENTERED_EVENT,
  DEMO_EXPLORED_EVENT,
  SIGNUP_COMPLETED_EVENT,
  setDemoTracking,
  shouldCountDemoEntry,
  trackDemoActed,
  trackDemoCta,
  trackDemoExplored,
} from "./demo-tracking";

interface Sent {
  event: string;
  data?: Record<string, string | number | boolean>;
}

/** A window with working sessionStorage and a recording Umami. */
function browser(): Sent[] {
  const store = new Map<string, string>();
  const sent: Sent[] = [];
  (globalThis as { window?: unknown }).window = {
    umami: {
      track: (event: string, data?: Record<string, string | number | boolean>) =>
        sent.push({ event, data }),
    },
  };
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  };
  return sent;
}

describe("demo event names", () => {
  it("never reuses a Google Ads conversion name", () => {
    // The demo must not be able to look like a signup, a created project or an
    // invited client, which are the events Google is told about.
    const conversions = ["signup_completed", "setup_completed", "project_created", "client_invited"];
    for (const name of [
      DEMO_ENTERED_EVENT,
      DEMO_EXPLORED_EVENT,
      DEMO_ACTED_EVENT,
      DEMO_CTA_EVENT,
    ]) {
      expect(conversions).not.toContain(name);
    }
    expect(SIGNUP_COMPLETED_EVENT).toBe("signup_completed");
  });
});

describe("demo funnel events", () => {
  beforeEach(() => {
    setDemoTracking(false);
  });

  it("sends nothing outside the demo", () => {
    const sent = browser();

    trackDemoExplored("project");
    trackDemoActed("project_created");
    trackDemoCta("start_free");

    expect(sent).toEqual([]);
  });

  it("records the first explore, the first action and each CTA click", () => {
    const sent = browser();
    setDemoTracking(true);

    trackDemoExplored("project");
    trackDemoActed("project_created");
    trackDemoCta("start_free");

    expect(sent.map((s) => s.event)).toEqual([
      DEMO_EXPLORED_EVENT,
      DEMO_ACTED_EVENT,
      DEMO_CTA_EVENT,
    ]);
  });

  it("carries what the visitor did, so a drop-off points somewhere specific", () => {
    const sent = browser();
    setDemoTracking(true);

    trackDemoExplored("tasks");
    trackDemoActed("task_created");
    trackDemoCta("client_view");

    expect(sent[0].data).toEqual({ what: "tasks" });
    expect(sent[1].data).toEqual({ what: "task_created" });
    expect(sent[2].data).toEqual({ which: "client_view" });
  });

  it("counts explore and act once per session, so one keen visitor is not a crowd", () => {
    const sent = browser();
    setDemoTracking(true);

    trackDemoExplored("project");
    trackDemoExplored("tasks");
    trackDemoActed("project_created");
    trackDemoActed("task_created");

    expect(sent.filter((s) => s.event === DEMO_EXPLORED_EVENT)).toHaveLength(1);
    expect(sent.filter((s) => s.event === DEMO_ACTED_EVENT)).toHaveLength(1);
    // The first one wins, so the funnel step reflects what got them in.
    expect(sent[0].data).toEqual({ what: "project" });
  });

  it("counts every CTA click, which is a choice rather than a milestone", () => {
    const sent = browser();
    setDemoTracking(true);

    trackDemoCta("start_free");
    trackDemoCta("start_free");

    expect(sent.filter((s) => s.event === DEMO_CTA_EVENT)).toHaveLength(2);
  });

  it("still counts an action for a visitor whose storage is blocked", () => {
    const sent = browser();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    setDemoTracking(true);

    trackDemoActed("project_created");

    expect(sent.map((s) => s.event)).toEqual([DEMO_ACTED_EVENT]);
  });
});

describe("shouldCountDemoEntry", () => {
  it("is true once per browser session", () => {
    browser();

    expect(shouldCountDemoEntry()).toBe(true);
    expect(shouldCountDemoEntry()).toBe(false);
  });
});
