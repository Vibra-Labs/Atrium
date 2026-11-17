/**
 * Whether this build is the public demo deployment.
 *
 * A build-time flag rather than something fetched: the demo runs on its own
 * instance, so the answer is the same for every request, and the banner should
 * not cost a round trip. The real boundary — what the demo workspace is allowed
 * to do — is enforced by DemoGuard on the API against the organization id.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

/** The message the API's DemoGuard returns for a blocked upload. */
export const DEMO_UPLOADS_OFF = "Uploads are turned off in the demo.";

/**
 * Why the upload control is disabled, or null when it isn't.
 *
 * Returns the API's own wording so the visitor reads one explanation whether
 * the UI stopped them or DemoGuard did.
 */
export function uploadDisabledReason(): string | null {
  return isDemoMode() ? DEMO_UPLOADS_OFF : null;
}
