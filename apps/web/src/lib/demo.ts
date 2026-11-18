/**
 * The demo workspace's client-side bits.
 *
 * The flag is passed in rather than read from a NEXT_PUBLIC_* variable: those
 * are inlined at build time, so a single build could not serve both the demo
 * instance and anything else, and the e2e suite could never exercise the demo
 * UI against a normal build. The server layouts read DEMO_MODE at request time
 * and hand it down through the session context.
 *
 * The real boundary — what the demo workspace may do — is enforced by
 * DemoGuard on the API against the organization id, never by this.
 */

/** The message the API's DemoGuard returns for a blocked upload. */
export const DEMO_UPLOADS_OFF = "Uploads are turned off in the demo.";

/**
 * Why the upload control is disabled, or null when it isn't. Returns the API's
 * own wording so the visitor reads one explanation whether the UI stopped them
 * or DemoGuard did.
 */
export function uploadDisabledReason(isDemo: boolean | undefined): string | null {
  return isDemo ? DEMO_UPLOADS_OFF : null;
}

/** Minutes between scheduled resets; the cron runs on the hour and the half hour. */
const RESET_INTERVAL_MINUTES = 30;

/**
 * How long until the demo workspace is reseeded, as a phrase.
 *
 * Shown instead of a Reset button. In a workspace several strangers share at
 * once, a manual reset is a control that can only do harm — one visitor wipes
 * the place out from under everyone else mid-click. As information it is
 * useful; as a button it is a footgun pointed at other people.
 *
 * Derived from the clock rather than fetched: the cron fires on the half hour,
 * so no round trip is needed, and if a reset is held off because someone is
 * active the countdown simply rolls to the next slot.
 */
export function resetCountdown(now: Date = new Date()): string {
  const minutesPast: number = now.getMinutes() % RESET_INTERVAL_MINUTES;
  const secondsPast: number = minutesPast * 60 + now.getSeconds();
  const secondsLeft: number = RESET_INTERVAL_MINUTES * 60 - secondsPast;
  const minutesLeft: number = Math.floor(secondsLeft / 60);

  if (minutesLeft < 1) return "in under a minute";
  if (minutesLeft === 1) return "in 1 minute";
  return `in ${minutesLeft} minutes`;
}
