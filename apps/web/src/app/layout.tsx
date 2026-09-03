import type { Metadata } from "next";
import Link from "next/link";
import { Providers } from "./providers";
import { maskAnalyticsEvent } from "@/lib/mask-analytics";
// @ts-expect-error — raw string import via webpack asset/source
import changelogRaw from "../../CHANGELOG.md";
import "./globals.css";

function latestChangelogVersion(): string {
  const match = (changelogRaw as string).match(/^## \[(.+?)\]/m);
  return match?.[1] ?? "0.0.0";
}

export const metadata: Metadata = {
  title: "Atrium",
  description: "Client portal for agencies and freelancers",
};

// Analytics must never carry identifiers. The hook is defined in
// lib/mask-analytics.ts and serialised into the page here so it runs for every
// event, including Umami's auto-tracked pageviews.
const MASK_FN = "atriumMaskAnalyticsEvent";
const MASK_SCRIPT = `window.${MASK_FN}=${maskAnalyticsEvent.toString()};`;

const ALLOWED_TRACKER_KEYS = new Set([
  "src",
  "async",
  "defer",
  "crossOrigin",
  "nonce",
  "type",
]);

function getTrackers(): Array<Record<string, string>> {
  const raw = process.env.NEXT_PUBLIC_TRACKERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is Record<string, string> => t && typeof t === "object" && typeof t.src === "string")
      .map((t) => {
        const safe: Record<string, string> = {};
        for (const [k, v] of Object.entries(t)) {
          if (ALLOWED_TRACKER_KEYS.has(k) || k.startsWith("data-")) {
            safe[k] = String(v);
          }
        }
        // Default the masking hook on; an operator can point it elsewhere.
        if (!safe["data-before-send"]) safe["data-before-send"] = MASK_FN;
        return safe;
      })
      .filter((t) => t.src);
  } catch {
    return [];
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const trackers = getTrackers();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Must be defined before the tracker loads: it is read per event. */}
        {trackers.length > 0 && (
          <script dangerouslySetInnerHTML={{ __html: MASK_SCRIPT }} />
        )}
        {/* A plain tag, not next/script: afterInteractive scripts are not
            emitted on statically prerendered routes (/signup, /accept-invite),
            which silently dropped ~85% of signups from analytics. */}
        {trackers.map((tracker, i) => (
          <script key={tracker.src || i} defer {...tracker} />
        ))}
      </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
        <Link
          href="/changelog"
          className="fixed bottom-3 right-3 text-[10px] font-mono text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors opacity-50 hover:opacity-100"
        >
          v{latestChangelogVersion()}
        </Link>
      </body>
    </html>
  );
}
