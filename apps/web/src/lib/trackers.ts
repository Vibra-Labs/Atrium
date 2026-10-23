/**
 * Analytics trackers, configured at runtime.
 *
 * ATRIUM_TRACKERS is a JSON array of script attributes, e.g.
 *   [{"src":"https://umami.example.com/script.js","data-website-id":"..."}]
 * NEXT_PUBLIC_TRACKERS is still read as a fallback for existing setups.
 *
 * Always pass `process.env` as `env`. Next replaces the literal expression
 * `process.env.NEXT_PUBLIC_*` with its build-time value, even in server code,
 * so reading it through a parameter is what keeps this a runtime lookup.
 */
type Env = Record<string, string | undefined>;
export type Tracker = Record<string, string>;

/** Global name of the masking hook from lib/mask-analytics.ts. */
export const MASK_FN = "atriumMaskAnalyticsEvent";

const ALLOWED_KEYS: Set<string> = new Set([
  "src",
  "async",
  "defer",
  "crossOrigin",
  "nonce",
  "type",
]);

export function getTrackers(env: Env): Tracker[] {
  const raw: string | undefined = env.ATRIUM_TRACKERS || env.NEXT_PUBLIC_TRACKERS;
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("ATRIUM_TRACKERS is not valid JSON; no trackers loaded", err);
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const trackers: Tracker[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || typeof entry.src !== "string" || !entry.src) {
      continue;
    }
    const safe: Tracker = {};
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (ALLOWED_KEYS.has(key) || key.startsWith("data-")) safe[key] = String(value);
    }
    // Default the masking hook on; an operator can point it elsewhere.
    if (!safe["data-before-send"]) safe["data-before-send"] = MASK_FN;
    trackers.push(safe);
  }
  return trackers;
}

/** Startup warning for the deprecated name. See docs/deprecations.md. */
export function trackersDeprecationWarning(env: Env): string | null {
  if (env.ATRIUM_TRACKERS || !env.NEXT_PUBLIC_TRACKERS) return null;
  return "NEXT_PUBLIC_TRACKERS is deprecated and will be removed in a future major release. Rename it to ATRIUM_TRACKERS (same value). See docs/deprecations.md.";
}
