import { describe, expect, it } from "bun:test";
import { createHmac } from "crypto";
import { MAX_ATTEMPTS, nextStep, signWebhook } from "./delivery-policy";

const fail = (statusCode: number | null, retryAfterMs: number | null = null) => ({
  ok: false, statusCode, error: "boom", retryAfterMs,
});

describe("nextStep", () => {
  it("marks 2xx as success", () => {
    expect(nextStep("webhook", 1, { ok: true, statusCode: 200, error: null, retryAfterMs: null }))
      .toEqual({ status: "success" });
  });

  it("backs off 1m, 5m, 30m, 2h, 12h, then gives up", () => {
    const delays = [1, 2, 3, 4, 5].map((n) => {
      const step = nextStep("webhook", n, fail(500));
      return step.status === "pending" ? step.delayMs / 60_000 : null;
    });
    expect(delays).toEqual([1, 5, 30, 120, 720]);
    expect(nextStep("webhook", MAX_ATTEMPTS, fail(500))).toEqual({ status: "failed" });
  });

  it("retries network errors", () => {
    expect(nextStep("webhook", 1, fail(null)).status).toBe("pending");
  });

  it("honours Retry-After on 429 when it is longer than the backoff", () => {
    const step = nextStep("slack", 1, fail(429, 10 * 60_000));
    expect(step).toEqual({ status: "pending", delayMs: 10 * 60_000 });
  });

  it("caps Retry-After at 12h", () => {
    const step = nextStep("slack", 1, fail(429, 99 * 3_600_000));
    expect(step).toEqual({ status: "pending", delayMs: 12 * 3_600_000 });
  });

  it("fails immediately when Slack or Discord say the webhook is gone", () => {
    expect(nextStep("slack", 1, fail(404))).toEqual({ status: "failed" });
    expect(nextStep("discord", 1, fail(410))).toEqual({ status: "failed" });
  });

  it("keeps retrying a 404 from a generic webhook", () => {
    expect(nextStep("webhook", 1, fail(404)).status).toBe("pending");
  });
});

describe("signWebhook", () => {
  it("signs `<timestamp>.<body>` with HMAC-SHA256", () => {
    const expected = createHmac("sha256", "whsec").update("1700000000.{\"a\":1}").digest("hex");
    expect(signWebhook("whsec", 1_700_000_000, "{\"a\":1}")).toBe(`t=1700000000,v1=${expected}`);
  });
});
