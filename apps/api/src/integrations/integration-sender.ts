import type { IntegrationType } from "@atrium/shared";
import { signWebhook, type SendResult } from "./delivery-policy";
import { formatBody } from "./formatters";
import type { IntegrationPayload } from "./integration-payload";
import { validateDestinationUrl, type UrlPolicy } from "./url-guard";

const TIMEOUT_MS = 10_000;
const ERROR_BODY_LIMIT = 1024;

export interface SendTarget {
  type: IntegrationType;
  url: string;
  secret: string | null;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface SenderDeps {
  fetchFn?: FetchFn;
  checkHost?: (hostname: string) => Promise<void>;
  now?: () => number;
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds: number = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date: number = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** One HTTP attempt. Never throws: every outcome comes back as a SendResult. */
export async function sendDelivery(
  target: SendTarget,
  payload: IntegrationPayload,
  deliveryId: string,
  policy: UrlPolicy,
  deps: SenderDeps = {},
): Promise<SendResult> {
  const fetchFn: FetchFn = deps.fetchFn ?? fetch;
  const now: number = (deps.now ?? Date.now)();

  const urlError: string | null = await validateDestinationUrl(target.type, target.url, policy, deps.checkHost);
  if (urlError) return { ok: false, statusCode: null, error: urlError, retryAfterMs: null };

  const body: string = formatBody(target.type, payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Atrium-Webhooks/1.0",
  };
  if (target.type === "webhook") {
    headers["X-Atrium-Event"] = payload.event;
    headers["X-Atrium-Delivery"] = deliveryId;
    if (target.secret) headers["X-Atrium-Signature"] = signWebhook(target.secret, Math.floor(now / 1000), body);
  }

  try {
    const res: Response = await fetchFn(target.url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 200 && res.status < 300) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: true, statusCode: res.status, error: null, retryAfterMs: null };
    }
    // A redirect could bounce us to an internal address, so it is never followed.
    const error: string = res.status >= 300 && res.status < 400
      ? `Received a ${res.status} redirect; redirects are not followed`
      : (await res.text().catch(() => "")).slice(0, ERROR_BODY_LIMIT) || `HTTP ${res.status}`;
    return {
      ok: false,
      statusCode: res.status,
      error,
      retryAfterMs: parseRetryAfter(res.headers.get("retry-after"), now),
    };
  } catch (err) {
    const error: string = err instanceof Error ? err.message : String(err);
    return { ok: false, statusCode: null, error: error.slice(0, ERROR_BODY_LIMIT), retryAfterMs: null };
  }
}
