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
