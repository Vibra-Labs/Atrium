/**
 * Strips identifiers out of analytics payloads before they leave the browser.
 *
 * Umami auto-tracks the full URL and page title, which in this app means
 * project and organization ids (/portal/projects/<cuid>), branded login slugs
 * and titles containing client names. Masking here means the identifiers are
 * never transmitted at all, rather than being sent and trusted to stay private.
 *
 * This is serialised into the page with .toString(), so it must stay
 * self-contained: no imports, no closure variables, no TypeScript-only syntax
 * in the body.
 */
export interface AnalyticsPayload {
  url?: string;
  title?: string;
  [key: string]: unknown;
}

export function maskAnalyticsEvent(
  type: string,
  payload: AnalyticsPayload,
): AnalyticsPayload {
  try {
    if (payload && typeof payload.url === "string") {
      // Drop the query string wholesale: ?task=<id>, ?id=<invitation>, etc.
      var u = payload.url.split("?")[0].split("#")[0];
      u = u.replace(
        /\/(c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\/|$)/gi,
        "/[id]",
      );
      u = u.replace(/^\/login\/[^/]+/, "/login/[slug]");
      u = u.replace(/^\/portal\/sign\/[^/]+/, "/portal/sign/[token]");
      payload.url = u;
    }
    if (payload) {
      // Titles carry project and client names.
      delete payload.title;
    }
  } catch {
    // Never let masking break the page; drop the event instead of leaking.
    return { url: "/[masking-error]" };
  }
  return payload;
}
