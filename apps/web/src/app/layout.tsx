import type { Metadata } from "next";
import Link from "next/link";
import { Providers } from "./providers";
import { Trackers } from "@/components/trackers";
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
  icons: { icon: "/icon-64.png" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Trackers />
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
