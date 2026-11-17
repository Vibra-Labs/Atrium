/**
 * Event names for the demo.
 *
 * Deliberately separate from the signup conversion the growth funnel is
 * measured by: a demo that counted as a signup would inflate the very number
 * it was built to improve, and the inflation would look like success.
 */
export const DEMO_ENTERED_EVENT = "atrium_demo_entered";

/**
 * The funnel's signup conversion, as `track.ts` names it in its GTM allowlist.
 * The demo never emits it — and `setDemoAnalytics` keeps the demo from reaching
 * the dataLayer with any of the other conversions either.
 */
export const SIGNUP_COMPLETED_EVENT = "signup_completed";

const ONCE_KEY = "atrium.demo.entered";

/**
 * True the first time it is called in a browser session. Entry is counted once
 * per visitor, so a reload or a second tab is not a second entry.
 */
export function shouldCountDemoEntry(): boolean {
  try {
    if (sessionStorage.getItem(ONCE_KEY)) return false;
    sessionStorage.setItem(ONCE_KEY, "1");
    return true;
  } catch {
    // Private mode, blocked storage: count it rather than lose it.
    return true;
  }
}
