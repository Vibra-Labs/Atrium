import { createHmac } from "crypto";
import type { IntegrationType } from "@atrium/shared";

/** Wait after the 1st..5th failed attempt. The 6th failure is final. */
const RETRY_DELAYS_MS: readonly number[] = [
  60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000,
];
export const MAX_ATTEMPTS: number = RETRY_DELAYS_MS.length + 1;
const MAX_DELAY_MS: number = RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];

/** Final failures in a row before a destination is switched off. */
export const AUTO_DISABLE_AFTER = 10;

export interface SendResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  retryAfterMs: number | null;
}

export type NextStep =
  | { status: "success" }
  | { status: "failed" }
  | { status: "pending"; delayMs: number };

/** Decide what happens to a delivery after its `attempts`-th attempt. */
export function nextStep(type: IntegrationType, attempts: number, result: SendResult): NextStep {
  if (result.ok) return { status: "success" };
  // Slack and Discord answer 404/410 once the webhook has been deleted; retrying can't help.
  const gone: boolean = result.statusCode === 404 || result.statusCode === 410;
  if (gone && type !== "webhook") return { status: "failed" };
  if (attempts >= MAX_ATTEMPTS) return { status: "failed" };

  const backoff: number = RETRY_DELAYS_MS[attempts - 1];
  const delayMs: number = Math.min(Math.max(backoff, result.retryAfterMs ?? 0), MAX_DELAY_MS);
  return { status: "pending", delayMs };
}

/** Stripe-style signature: receivers recompute HMAC(secret, "<t>.<raw body>") and compare. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  const digest: string = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}
