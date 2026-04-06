import * as Sentry from "@sentry/nestjs";
import type { Event } from "@sentry/nestjs";

function scrubEvent(event: Event): Event {
  if (event.request) {
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers["cookie"];
      delete event.request.headers["authorization"];
      delete event.request.headers["set-cookie"];
    }
  }
  if (event.user) {
    delete event.user.email;
    delete event.user.username;
    delete event.user.ip_address;
  }
  return event;
}

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  // SENTRY_ENABLED=true → hosted deployment, always captures.
  // Absent → self-hosted, enabled only when org owner opts in (controlled via web dashboard).
  const enabled = process.env.SENTRY_ENABLED === "true";

  Sentry.init({
    dsn,
    enabled,
    tracesSampleRate: 0.1,
    beforeSend: scrubEvent,
  });
}

/**
 * Dynamically toggle Sentry on/off at runtime when the org owner changes
 * the telemetry preference via the settings dashboard.
 */
export function setSentryEnabled(enabled: boolean) {
  const client = Sentry.getClient();
  if (client) {
    client.getOptions().enabled = enabled;
  }
}
