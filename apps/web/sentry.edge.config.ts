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

if (process.env.SENTRY_DSN) {
  const enabled = process.env.SENTRY_ENABLED === "true";
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    enabled: enabled,
    tracesSampleRate: 0.1,
    beforeSend: scrubEvent,
  });
}
