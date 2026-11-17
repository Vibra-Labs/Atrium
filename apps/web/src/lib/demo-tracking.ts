/**
 * The demo's own funnel: entered → explored → acted → clicked a CTA.
 *
 * One number (entries) only says whether traffic arrived. Four say where it
 * stopped: a visitor who entered and never explored is a first-impression
 * problem, one who explored but never acted is a product problem, and one who
 * acted but never clicked through is a pricing or trust problem.
 *
 * Umami only, always. These names are deliberately nothing like the four
 * events `track.ts` forwards to Google Ads — a demo that could look like a
 * signup or a created project would inflate the very number it exists to
 * improve, and the inflation would read as success. `setDemoAnalytics` in
 * track.ts stops the demo reaching the dataLayer at all; this keeps the names
 * distinct as well, so neither mistake can be made from either side.
 */
export const DEMO_ENTERED_EVENT = "atrium_demo_entered";
export const DEMO_EXPLORED_EVENT = "atrium_demo_explored";
export const DEMO_ACTED_EVENT = "atrium_demo_acted";
export const DEMO_CTA_EVENT = "atrium_demo_cta_clicked";

/**
 * The funnel's signup conversion, as `track.ts` names it in its GTM allowlist.
 * Here so the tests above can assert no demo event collides with it.
 */
export const SIGNUP_COMPLETED_EVENT = "signup_completed";

const ENTERED_KEY = "atrium.demo.entered";
const EXPLORED_KEY = "atrium.demo.explored";
const ACTED_KEY = "atrium.demo.acted";

/**
 * Whether this page is the demo workspace.
 *
 * A module flag set by SessionProvider, like the one in track.ts. Two flags
 * rather than one shared helper because track.ts cannot import this module —
 * this module calls `track()` — and a cycle between them is not worth saving
 * one line. Each owns its own concern: that one suppresses Ads conversions,
 * this one enables demo telemetry.
 */
let inDemo = false;

export function setDemoTracking(isDemo: boolean): void {
  inDemo = isDemo;
}

/**
 * True the first time it is called in a browser session for `key`.
 *
 * Milestones are counted once so one keen visitor clicking through ten
 * projects does not read as ten explorers. When storage is unavailable
 * (private mode, blocked site data) it counts — a slightly inflated number is
 * better than a silently lost one.
 */
function firstTime(key: string): boolean {
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}

/** True the first time the visitor enters the demo this session. */
export function shouldCountDemoEntry(): boolean {
  return firstTime(ENTERED_KEY);
}

function send(event: string, data: Record<string, string>): void {
  if (!inDemo) return;
  if (typeof window === "undefined") return;
  // Imported lazily so this module stays loadable from a test without the
  // whole analytics surface, and so track.ts never has to import this one.
  const umami = (window as { umami?: { track: (e: string, d?: unknown) => void } }).umami;
  try {
    umami?.track(event, data);
  } catch (error) {
    console.error("Demo event failed", error);
  }
}

/**
 * The visitor looked at something — opened a project, switched a tab. Counted
 * once; the first thing they opened is what got them in, so it is the one
 * worth keeping.
 */
export function trackDemoExplored(what: string): void {
  if (!inDemo) return;
  if (!firstTime(EXPLORED_KEY)) return;
  send(DEMO_EXPLORED_EVENT, { what });
}

/**
 * The visitor changed something — created a project, added a task, posted an
 * update. The demo equivalent of the trial signal that actually predicts
 * buying, and counted once for the same reason as explore.
 */
export function trackDemoActed(what: string): void {
  if (!inDemo) return;
  if (!firstTime(ACTED_KEY)) return;
  send(DEMO_ACTED_EVENT, { what });
}

/**
 * The visitor clicked "Start free" or "See the client view". Every click is
 * counted, not just the first: this is a choice they make repeatedly, not a
 * milestone they pass once, and the repeat is itself informative.
 */
export function trackDemoCta(which: string): void {
  send(DEMO_CTA_EVENT, { which });
}
