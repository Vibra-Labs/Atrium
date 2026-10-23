import type { Instrumentation } from "next";
import { resolveInternalApiUrl } from "./lib/internal-api-url";
import { shouldInitServerSentry } from "./lib/sentry-config";
import { trackersDeprecationWarning } from "./lib/trackers";

/**
 * Runs once when the server starts. Exits on a missing INTERNAL_API_URL, as
 * the API does on a missing DATABASE_URL: Next would otherwise keep running
 * and answer every page with a 500. Loads the Sentry server/edge config when
 * a SENTRY_DSN is set.
 */
export async function register(): Promise<void> {
  // `next build` may load this too, and builds don't set the variable.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      resolveInternalApiUrl(process.env);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
    const trackersWarning: string | null = trackersDeprecationWarning(process.env);
    if (trackersWarning) console.warn(trackersWarning);
  }

  if (!shouldInitServerSentry(process.env)) return;
  try {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      await import("../sentry.server.config");
    } else if (process.env.NEXT_RUNTIME === "edge") {
      await import("../sentry.edge.config");
    }
  } catch (err) {
    console.error("Failed to initialise Sentry", err);
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!shouldInitServerSentry(process.env)) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureRequestError(...args);
  } catch (err) {
    console.error("Failed to report request error", err);
  }
};
