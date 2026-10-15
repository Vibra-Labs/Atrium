import { describe, expect, it, mock } from "bun:test";
import { createHmac } from "crypto";
import { sendDelivery } from "./integration-sender";
import type { IntegrationPayload } from "./integration-payload";

const payload: IntegrationPayload = {
  id: "evt_1", event: "invoice.paid", createdAt: "2026-10-15T12:00:00.000Z",
  workspace: { id: "org1", name: "Acme" }, project: null, actor: null,
  title: "Invoice INV-1 paid", detail: null, data: {}, url: "https://app.test/dashboard",
};
const policy = { allowPrivate: false, allowHttp: false };
const publicHost = async (): Promise<void> => {};

function fakeFetch(status: number, body = "", headers: Record<string, string> = {}) {
  return mock(async (_url: string, _init: RequestInit) => new Response(body, { status, headers }));
}

describe("sendDelivery", () => {
  it("posts signed JSON to generic webhooks", async () => {
    const fetchFn = fakeFetch(200);
    const result = await sendDelivery(
      { type: "webhook", url: "https://hooks.example.com/x", secret: "whsec" },
      payload, "del_1", policy, { fetchFn, checkHost: publicHost, now: () => 1_700_000_000_000 },
    );

    expect(result).toEqual({ ok: true, statusCode: 200, error: null, retryAfterMs: null });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://hooks.example.com/x");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Atrium-Event"]).toBe("invoice.paid");
    expect(headers["X-Atrium-Delivery"]).toBe("del_1");
    const sig = createHmac("sha256", "whsec").update(`1700000000.${init.body}`).digest("hex");
    expect(headers["X-Atrium-Signature"]).toBe(`t=1700000000,v1=${sig}`);
  });

  it("does not sign Slack messages", async () => {
    const fetchFn = fakeFetch(200);
    await sendDelivery(
      { type: "slack", url: "https://hooks.slack.com/services/a", secret: null },
      payload, "del_1", policy, { fetchFn, checkHost: publicHost },
    );
    const headers = fetchFn.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["X-Atrium-Signature"]).toBeUndefined();
  });

  it("refuses to send when the host now resolves to a private address", async () => {
    const fetchFn = fakeFetch(200);
    const result = await sendDelivery(
      { type: "webhook", url: "https://rebound.example/x", secret: "s" },
      payload, "del_1", policy,
      { fetchFn, checkHost: async () => { throw new Error("private"); } },
    );
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reports non-2xx with a capped error body", async () => {
    const result = await sendDelivery(
      { type: "webhook", url: "https://hooks.example.com/x", secret: "s" },
      payload, "del_1", policy, { fetchFn: fakeFetch(500, "e".repeat(5000)), checkHost: publicHost },
    );
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.error!.length).toBeLessThanOrEqual(1024);
  });

  it("treats redirects as failures", async () => {
    const result = await sendDelivery(
      { type: "webhook", url: "https://hooks.example.com/x", secret: "s" },
      payload, "del_1", policy,
      { fetchFn: fakeFetch(302, "", { location: "http://169.254.169.254/" }), checkHost: publicHost },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("redirect");
  });

  it("parses Retry-After seconds", async () => {
    const result = await sendDelivery(
      { type: "slack", url: "https://hooks.slack.com/services/a", secret: null },
      payload, "del_1", policy, { fetchFn: fakeFetch(429, "", { "retry-after": "120" }), checkHost: publicHost },
    );
    expect(result.retryAfterMs).toBe(120_000);
  });

  it("turns network errors into a failed result", async () => {
    const fetchFn = mock(async () => { throw new Error("ECONNREFUSED"); });
    const result = await sendDelivery(
      { type: "webhook", url: "https://hooks.example.com/x", secret: "s" },
      payload, "del_1", policy, { fetchFn, checkHost: publicHost },
    );
    expect(result).toEqual({ ok: false, statusCode: null, error: "ECONNREFUSED", retryAfterMs: null });
  });
});
