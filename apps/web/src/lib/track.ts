/**
 * Analytics event helpers.
 *
 * Events go to two places, independently and best-effort:
 *   - Umami, when its script has loaded (no-op otherwise).
 *   - Google Tag Manager's `dataLayer`, always.
 *
 * The dataLayer push is deliberate: the GTM container used to reach these
 * events by wrapping `window.umami.track`, which meant an unreachable or
 * blocked Umami silently took Google Ads conversion tracking down with it.
 * Pushing directly keeps the two independent.
 */

type TrackData = Record<string, string | number | boolean>;

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
 * Pushes onto GTM's queue, creating it when the container hasn't loaded yet.
 * Returns false if the push threw, so callers waiting on it can stop waiting.
 */
function pushToDataLayer(entry: Record<string, unknown>): boolean {
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
  // `event` last so a caller's data key can never overwrite the event name.
  pushToDataLayer({ ...data, event });
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
 * With no container on the page nothing will ever call `eventCallback`, so
 * waiting would stall the redirect for the whole timeout and buy nothing.
 * That is the default for self-hosted installs, dev and e2e, where
 * ATRIUM_TRACKERS is unset -- so navigate at once instead.
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

  if (!gtmLoaded()) {
    pushToDataLayer({ ...data, event });
    go();
    return;
  }

  const timer: ReturnType<typeof setTimeout> = setTimeout(
    go,
    timeoutMs + FALLBACK_GRACE_MS,
  );

  const pushed: boolean = pushToDataLayer({
    ...data,
    event,
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
