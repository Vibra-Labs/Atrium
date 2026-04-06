import * as Sentry from "@sentry/nextjs";
import type { Event } from "@sentry/nextjs";

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

// Only initialize if DSN is provided (it won't be in most dev environments)
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  // NEXT_PUBLIC_SENTRY_ENABLED=true → hosted deployment, always on, no consent needed.
  // Absent → self-hosted deployment, starts disabled until the owner opts in.
  const enabled = process.env.NEXT_PUBLIC_SENTRY_ENABLED === "true";

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    enabled: enabled,
    tracesSampleRate: 0.1,
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "Non-Error promise rejection captured",
    ],
    beforeSend: scrubEvent,
  });
}
