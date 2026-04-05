import * as Sentry from "@sentry/nestjs";

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
  });
}
