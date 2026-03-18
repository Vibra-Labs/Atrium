import type { Metadata } from "next";
import Script from "next/script";
import Link from "next/link";
import { Providers } from "./providers";
import pkg from "../../package.json";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atrium",
  description: "Client portal for agencies and freelancers",
};

const ALLOWED_TRACKER_KEYS = new Set([
  "src",
  "strategy",
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
        {trackers.map((tracker, i) => (
          <Script
            key={tracker.src || i}
            defer
            strategy="afterInteractive"
            {...tracker}
          />
        ))}
      </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
        <Link
          href="/changelog"
          className="fixed bottom-3 right-3 text-[10px] font-mono text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors opacity-50 hover:opacity-100"
        >
          v{pkg.version}
        </Link>
      </body>
    </html>
  );
}
