import { afterEach, describe, expect, it } from "bun:test";
import { track, trackThenNavigate, setDemoAnalytics } from "./track";

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

/**
 * A window with a GTM container already executed. Nothing is pushed without
 * one, so every dataLayer assertion needs it.
 */
function gtmWindow(): StubWindow {
  return { location: { href: "" }, google_tag_manager: {} };
}

/** A window with both a container and Umami, recording what Umami was sent. */
function umamiWindow(): { win: StubWindow; sent: Array<[string, TrackedData | undefined]> } {
  const sent: Array<[string, TrackedData | undefined]> = [];
  const win: StubWindow = {
    ...gtmWindow(),
    umami: {
      track: (event: string, data?: TrackedData) => {
        sent.push([event, data]);
      },
    },
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
    const win: StubWindow = gtmWindow();
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
    const win: StubWindow = { ...gtmWindow(), dataLayer: [{ event: "gtm.js" }] };
    setWindow(win);

    track("project_created");

    expect(win.dataLayer).toEqual([{ event: "gtm.js" }, { event: "project_created" }]);
  });

  it("still reaches dataLayer when Umami throws", () => {
    const win: StubWindow = {
      ...gtmWindow(),
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
    const win: StubWindow = gtmWindow();
    setWindow(win);

    track("setup_completed");

    expect(win.dataLayer).toEqual([{ event: "setup_completed" }]);
  });
});

describe("what reaches Google", () => {
  // Umami is self-hosted, so it gets everything. The dataLayer leaves the
  // browser, so it gets the four conversion events and nothing else.
  it("sends product telemetry to Umami but never to dataLayer", () => {
    const { win, sent } = umamiWindow();
    setWindow(win);

    track("login_succeeded", { branded: true, oauth: false });
    track("portal_file_downloaded", { type: "pdf" });
    track("invoice_created", { amount: 4200 });

    expect(sent).toHaveLength(3);
    expect(win.dataLayer).toBeUndefined();
  });

  // Regression guard: `signup_failed` carries err.message straight off the
  // API response. Umami may have it; Google may not.
  it("never hands a server error message to Google", () => {
    const { win, sent } = umamiWindow();
    setWindow(win);

    track("signup_failed", { reason: "duplicate email bob@acme.com", plan: "pro" });

    expect(sent).toEqual([
      ["signup_failed", { reason: "duplicate email bob@acme.com", plan: "pro" }],
    ]);
    expect(win.dataLayer).toBeUndefined();
  });

  // Allowlisted rather than filtered, so a field added to a call site later
  // cannot start leaving the browser on its own.
  it("drops event data Google has no business receiving", () => {
    const win: StubWindow = gtmWindow();
    setWindow(win);

    track("project_created", { source: "setup", client_email: "bob@acme.com", plan: "pro" });

    expect(win.dataLayer).toEqual([{ event: "project_created", plan: "pro" }]);
  });

  it("keeps the event name even when data tries to overwrite it", () => {
    const win: StubWindow = gtmWindow();
    setWindow(win);

    track("signup_completed", { event: "spoofed", plan: "free" } as unknown as TrackedData);

    expect(win.dataLayer).toEqual([{ event: "signup_completed", plan: "free" }]);
  });

  // Nothing drains the queue without a container, so entries would pile up in
  // memory for the life of the tab. That is the default deployment.
  it("queues nothing when no GTM container has loaded", () => {
    const win: StubWindow = gtmWindow();
    delete win.google_tag_manager;
    setWindow(win);

    track("signup_completed", { plan: "free" });

    expect(win.dataLayer).toBeUndefined();
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
    expect(win.dataLayer).toBeUndefined();
  });

  // Nothing will ever call back for an event Google isn't told about, so
  // waiting on one would stall the redirect for the full timeout.
  it("navigates immediately for an event Google is not told about", () => {
    const { win } = umamiWindow();
    setWindow(win);

    trackThenNavigate("portal_request_posted", undefined, "/portal", 10_000);

    expect(win.location?.href).toBe("/portal");
    expect(win.dataLayer).toBeUndefined();
  });

  it("carries the event name and allowlisted data into the push", () => {
    const { win } = umamiWindow();
    setWindow(win);

    trackThenNavigate("signup_completed", { plan: "lifetime" }, "/setup");

    const pushed = win.dataLayer?.[0] as Record<string, unknown>;
    expect(pushed.event).toBe("signup_completed");
    expect(pushed.plan).toBe("lifetime");
    expect(pushed.eventTimeout).toBe(1500);
  });
});

describe("track in the public demo", () => {
  // The demo lets a stranger create a project, and project_created is one of
  // the four Google Ads conversions. Left alone, every demo visitor who made a
  // project would be counted as an ad conversion -- inflating the exact number
  // the demo was built to improve, and spending real money on it.
  afterEach(() => {
    setDemoAnalytics(false);
  });

  it("keeps conversion events out of the dataLayer", () => {
    const pushed: unknown[] = [];
    (globalThis as { window?: unknown }).window = {
      dataLayer: { push: (entry: unknown) => pushed.push(entry) },
      google_tag_manager: {},
    };

    setDemoAnalytics(true);
    track("project_created", { source: "dashboard" });

    expect(pushed).toEqual([]);
  });

  it("still sends them to Umami, which is where demo telemetry belongs", () => {
    const umamiEvents: string[] = [];
    (globalThis as { window?: unknown }).window = {
      umami: { track: (event: string) => umamiEvents.push(event) },
      google_tag_manager: {},
    };

    setDemoAnalytics(true);
    track("project_created", { source: "dashboard" });

    expect(umamiEvents).toEqual(["project_created"]);
  });

  it("pushes again once the flag is off, so the real app is unaffected", () => {
    const pushed: unknown[] = [];
    (globalThis as { window?: unknown }).window = {
      dataLayer: { push: (entry: unknown) => pushed.push(entry) },
      google_tag_manager: {},
    };

    setDemoAnalytics(false);
    track("project_created", { source: "dashboard" });

    expect(pushed).toHaveLength(1);
  });
});
