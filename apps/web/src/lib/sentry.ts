"use client";

/**
 * Call this after the owner has consented to telemetry.
 * Dynamically enables the Sentry client so errors are reported going forward.
 * The SDK is imported on demand, so builds without a DSN never load it.
 */
export async function enableSentry(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    const client = Sentry.getClient();
    if (client) {
      client.getOptions().enabled = true;
    }
  } catch (err) {
    console.error("Failed to enable Sentry", err);
  }
}
