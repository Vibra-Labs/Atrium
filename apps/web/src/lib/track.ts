/**
 * Analytics event helpers.
 *
 * Events go to two places, independently and best-effort:
 *   - Umami, in full. Self-hosted, so this is the complete product telemetry.
 *   - Google Tag Manager's `dataLayer`, but only the handful of events that
 *     are Google Ads conversions, and only the fields listed below.
 *
 * The dataLayer push is deliberate: the GTM container used to reach these
 * events by wrapping `window.umami.track`, which meant an unreachable or
 * blocked Umami silently took Google Ads conversion tracking down with it.
 * Pushing directly keeps the two independent.
 */

type TrackData = Record<string, string | number | boolean>;

/** One entry on GTM's `dataLayer` queue. */
type GtmEntry = Record<string, unknown>;

/**
 * The only events Google is told about -- the four that are set up as Ads
 * conversions. Everything else is internal product telemetry and stays in
 * Umami. Without this an event like `signup_failed` would hand Google a raw
 * server error message, and `portal_file_downloaded` would describe a client's
 * activity, neither of which has anything to do with ad attribution.
 */
const GTM_EVENTS: ReadonlySet<string> = new Set([
  "signup_completed",
  "setup_completed",
  "project_created",
  "client_invited",
]);

/**
 * The only event data Google receives, allowlisted rather than filtered, so a
 * new field added to a call site can't start leaving the browser by accident.
 * `plan` is here because conversion value depends on it; nothing else about
 * the event matters to Ads.
 */
const GTM_DATA_KEYS: readonly string[] = ["plan"];

/** How long to let GTM fire an event's tags before navigating anyway. */
const NAVIGATE_TIMEOUT_MS: number = 1500;

/**
 * Our own fallback runs slightly after the `eventTimeout` we hand GTM, so
 * GTM's fallback wins the race and the two don't fire at the same instant.
 */
const FALLBACK_GRACE_MS: number = 250;

/**
 * True once a GTM container has executed on this page. GTM defines this
 * synchronously as it runs, and trackers are injected with `defer`, so by the
 * time a user submits a form the answer is settled.
 *
 * Nothing is pushed when this is false. With no container there is no consumer
 * to drain the queue, so entries would accumulate in memory for the life of
 * the tab -- and that is the default case: self-hosted installs, dev and e2e
 * never load GTM at all.
 */
function gtmLoaded(): boolean {
  return typeof window.google_tag_manager !== "undefined";
}

function sendToUmami(event: string, data?: TrackData): void {
  try {
    window.umami?.track(event, data);
  } catch (err) {
    console.error("umami track failed", err);
  }
}

/**
 * True while this page is the public demo workspace.
 *
 * The demo lets a stranger create a project, and `project_created` is one of
 * the four Ads conversions below. Without this, every demo visitor who made a
 * project would be counted as a Google Ads conversion — inflating the number
 * the demo exists to improve, and spending real ad budget against it.
 *
 * Module-level rather than threaded through every call site, because the
 * answer is a property of the page, not of the event. Umami still receives
 * everything: demo telemetry is worth having, it just isn't an ad conversion.
 */
let demoAnalytics = false;

/** Set from the session provider, which knows whether this workspace is the demo. */
export function setDemoAnalytics(isDemo: boolean): void {
  demoAnalytics = isDemo;
}

/**
 * Whether this whole deployment is the public demo.
 *
 * The flag above comes from the session provider, which only the dashboard and
 * portal layouts mount. Signup and the setup wizard are in their own route
 * groups with no provider — so `signup_completed`, `setup_completed` and
 * `client_invited` were ungated on precisely the path a visitor takes from the
 * demo's own "Start free" button when `DEMO_APP_URL` is unset and it resolves
 * to the demo host: they sign up there and book four real Ads conversions
 * against a throwaway instance.
 *
 * The deployment is the honest unit for that question, so the demo instance
 * sets `NEXT_PUBLIC_DEMO_MODE=true` and every route is covered, provider or
 * not. Read inside a function so tests can set it; Next.js still inlines the
 * value at build time.
 */
function onDemoInstance(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

/**
 * The entry to push for `event`, or null when the event isn't one Google is
 * told about.
 */
function gtmEntry(event: string, data?: TrackData): GtmEntry | null {
  // Both demo gates live here, so every path that reaches the dataLayer —
  // `track` and `trackThenNavigate` alike — is covered by one check. In
  // particular trackThenNavigate then treats a demo conversion like any event
  // Google isn't told about and navigates at once, rather than waiting out the
  // timeout for a callback that will never come.
  if (demoAnalytics || onDemoInstance()) return null;
  if (!GTM_EVENTS.has(event)) return null;

  const entry: GtmEntry = {};
  for (const key of GTM_DATA_KEYS) {
    if (data && key in data) entry[key] = data[key];
  }
  // Last, so an allowlisted key can never overwrite the event name.
  entry.event = event;
  return entry;
}

/**
 * Pushes onto GTM's queue, creating it if the container made it to the page
 * before its queue did. Returns false if the push threw, so callers waiting
 * on it can stop waiting.
 */
function pushToDataLayer(entry: GtmEntry): boolean {
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(entry);
    return true;
  } catch (err) {
    console.error("dataLayer push failed", err);
    return false;
  }
}

export function track(event: string, data?: TrackData): void {
  if (typeof window === "undefined") return;

  sendToUmami(event, data);

  const entry: GtmEntry | null = gtmEntry(event, data);
  if (entry && gtmLoaded()) pushToDataLayer(entry);
}

/**
 * Fires `event`, then sends the browser to `url` once GTM reports that the
 * event's tags have run.
 *
 * Navigating on the line after a plain `track()` can tear the page down
 * before GTM has evaluated the event, so the conversion tag never fires.
 * `eventCallback` closes that race; `timeoutMs` guarantees the user still
 * moves on when GTM is blocked or slow.
 *
 * With no container on the page -- or for an event Google isn't told about --
 * nothing will ever call `eventCallback`, so waiting would stall the redirect
 * for the whole timeout and buy nothing. Navigate at once instead.
 */
export function trackThenNavigate(
  event: string,
  data: TrackData | undefined,
  url: string,
  timeoutMs: number = NAVIGATE_TIMEOUT_MS,
): void {
  if (typeof window === "undefined") return;

  sendToUmami(event, data);

  let navigated: boolean = false;
  const go = (): void => {
    if (navigated) return;
    navigated = true;
    window.location.href = url;
  };

  const entry: GtmEntry | null = gtmEntry(event, data);
  if (!entry || !gtmLoaded()) {
    go();
    return;
  }

  const timer: ReturnType<typeof setTimeout> = setTimeout(
    go,
    timeoutMs + FALLBACK_GRACE_MS,
  );

  const pushed: boolean = pushToDataLayer({
    ...entry,
    eventCallback: () => {
      clearTimeout(timer);
      go();
    },
    eventTimeout: timeoutMs,
  });

  if (!pushed) {
    clearTimeout(timer);
    go();
  }
}
