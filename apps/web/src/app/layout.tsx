import type { Metadata } from "next";
import Script from "next/script";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atrium",
  description: "Client portal for agencies and freelancers",
};

function getTrackers(): Array<Record<string, string>> {
  const raw = process.env.NEXT_PUBLIC_TRACKERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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
    <html lang="en">
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
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
