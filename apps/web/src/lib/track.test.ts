import { afterEach, describe, expect, it } from "bun:test";
import { track, trackThenNavigate } from "./track";

type TrackedData = Record<string, string | number | boolean>;

interface StubWindow {
  umami?: { track: (event: string, data?: TrackedData) => void };
  dataLayer?: Record<string, unknown>[];
  location?: { href: string };
  google_tag_manager?: Record<string, unknown>;
}

function setWindow(win: StubWindow | undefined): void {
  const g = globalThis as { window?: unknown };
  if (win === undefined) {
    delete g.window;
    return;
  }
  g.window = win;
}

/** A window with Umami loaded, recording what it was asked to send. */
function umamiWindow(): { win: StubWindow; sent: Array<[string, TrackedData | undefined]> } {
  const sent: Array<[string, TrackedData | undefined]> = [];
  const win: StubWindow = {
    umami: {
      track: (event: string, data?: TrackedData) => {
        sent.push([event, data]);
      },
    },
    location: { href: "" },
    // A GTM container has executed; without this trackThenNavigate takes the
    // no-container shortcut and never waits for eventCallback.
    google_tag_manager: {},
  };
  return { win, sent };
}

afterEach(() => setWindow(undefined));

describe("track", () => {
  it("does nothing, and does not throw, without a window", () => {
    setWindow(undefined);
    expect(() => track("signup_completed")).not.toThrow();
  });

  it("pushes to dataLayer even when Umami never loaded", () => {
    const win: StubWindow = {};
    setWindow(win);

    track("signup_completed", { plan: "free" });

    expect(win.dataLayer).toEqual([{ event: "signup_completed", plan: "free" }]);
  });

  it("sends to Umami and dataLayer together", () => {
    const { win, sent } = umamiWindow();
    setWindow(win);

    track("signup_completed", { plan: "pro" });

    expect(sent).toEqual([["signup_completed", { plan: "pro" }]]);
    expect(win.dataLayer).toEqual([{ event: "signup_completed", plan: "pro" }]);
  });

  it("appends to an existing dataLayer rather than replacing it", () => {
    const win: StubWindow = { dataLayer: [{ event: "gtm.js" }] };
    setWindow(win);

    track("project_created");

    expect(win.dataLayer).toEqual([{ event: "gtm.js" }, { event: "project_created" }]);
  });

  it("still reaches dataLayer when Umami throws", () => {
    const win: StubWindow = {
      umami: {
        track: () => {
          throw new Error("umami exploded");
        },
      },
    };
    setWindow(win);

    expect(() => track("signup_completed")).not.toThrow();
    expect(win.dataLayer).toEqual([{ event: "signup_completed" }]);
  });

  it("omits data keys when no data is given", () => {
    const win: StubWindow = {};
    setWindow(win);

    track("login_succeeded");

    expect(win.dataLayer).toEqual([{ event: "login_succeeded" }]);
  });
});

describe("trackThenNavigate", () => {
  it("navigates as soon as GTM runs the event callback", () => {
    const { win } = umamiWindow();
    setWindow(win);

    trackThenNavigate("signup_completed", { plan: "free" }, "/setup");

    const pushed = win.dataLayer?.[0] as { eventCallback: () => void } | undefined;
    expect(typeof pushed?.eventCallback).toBe("function");
    expect(win.location?.href).toBe("");

    pushed?.eventCallback();
    expect(win.location?.href).toBe("/setup");
  });

  it("navigates anyway when GTM never calls back", async () => {
    const { win } = umamiWindow();
    setWindow(win);

    // The fallback timer is timeoutMs + FALLBACK_GRACE_MS, so wait past both.
    trackThenNavigate("signup_completed", { plan: "free" }, "/setup", 10);

    expect(win.location?.href).toBe("");
    await new Promise((r) => setTimeout(r, 400));
    expect(win.location?.href).toBe("/setup");
  });

  it("navigates only once when the callback and the timeout both fire", async () => {
    const { win } = umamiWindow();
    setWindow(win);
    let navigations: number = 0;
    Object.defineProperty(win.location as object, "href", {
      set: () => {
        navigations += 1;
      },
      get: () => "",
    });

    trackThenNavigate("signup_completed", undefined, "/setup", 10);

    const pushed = win.dataLayer?.[0] as { eventCallback: () => void };
    pushed.eventCallback();
    // Wait past the fallback timer too, so it would show up if it also fired.
    await new Promise((r) => setTimeout(r, 400));

    expect(navigations).toBe(1);
  });

  it("navigates at once, not after the timeout, when the push throws", () => {
    const { win } = umamiWindow();
    win.dataLayer = {
      push: () => {
        throw new Error("gtm exploded");
      },
    } as unknown as Record<string, unknown>[];
    setWindow(win);

    trackThenNavigate("signup_completed", undefined, "/setup", 10_000);

    expect(win.location?.href).toBe("/setup");
  });

  // Regression guard: waiting on eventCallback when no container exists
  // stalled every signup redirect for the full timeout. ATRIUM_TRACKERS is
  // unset by default, so that is the common deployment, not an edge case.
  it("navigates immediately when no GTM container has loaded", () => {
    const { win } = umamiWindow();
    delete win.google_tag_manager;
    setWindow(win);

    trackThenNavigate("signup_completed", { plan: "free" }, "/setup", 10_000);

    expect(win.location?.href).toBe("/setup");
  });

  it("still queues the event when no GTM container has loaded", () => {
    const { win } = umamiWindow();
    delete win.google_tag_manager;
    setWindow(win);

    trackThenNavigate("signup_completed", { plan: "free" }, "/setup", 10_000);

    expect(win.dataLayer).toEqual([{ plan: "free", event: "signup_completed" }]);
  });

  it("carries the event name and data into the push", () => {
    const { win } = umamiWindow();
    setWindow(win);

    trackThenNavigate("signup_completed", { plan: "lifetime" }, "/setup");

    const pushed = win.dataLayer?.[0] as Record<string, unknown>;
    expect(pushed.event).toBe("signup_completed");
    expect(pushed.plan).toBe("lifetime");
    expect(pushed.eventTimeout).toBe(1500);
  });
});
