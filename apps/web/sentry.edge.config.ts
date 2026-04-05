import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN) {
  const enabled = process.env.SENTRY_ENABLED === "true";
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    enabled: enabled,
    tracesSampleRate: 0.1,
  });
}
