"use client";

import * as Sentry from "@sentry/nextjs";

/**
 * Call this after the owner has consented to telemetry.
 * Dynamically enables the Sentry client so errors are reported going forward.
 */
export function enableSentry() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  const client = Sentry.getClient();
  if (client) {
    client.getOptions().enabled = true;
  }
}
