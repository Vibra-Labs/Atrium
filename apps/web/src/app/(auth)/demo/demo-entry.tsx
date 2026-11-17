"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export type DemoKind = "owner" | "client";

/**
 * Posts to the demo entry endpoint and follows the sign-in redirect.
 *
 * A page rather than a plain link because entry must not be a GET: prefetchers,
 * mail scanners and chat-app previews fetch GET links, and each fetch would
 * spend a sign-in link and inflate the entry count.
 */
export function DemoEntry({ kind }: { kind: DemoKind }): React.ReactElement {
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function enter(): Promise<void> {
      try {
        const response = await fetch(`${API_URL}/api/demo/enter`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind }),
          redirect: "follow",
        });
        if (!response.ok && response.type !== "opaqueredirect") {
          setFailed(true);
          return;
        }
        window.location.href = response.url;
      } catch (error) {
        console.error("Demo entry failed", error);
        setFailed(true);
      }
    }

    void enter();
  }, [kind]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        {failed ? (
          <>
            <h1 className="text-2xl font-bold">The demo is unavailable</h1>
            <p className="text-[var(--muted-foreground)]">
              Something went wrong opening the demo. You can still start a free workspace.
            </p>
            <Link href="/signup?ref=demo" className="text-[var(--primary)] hover:underline">
              Start free
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Opening the demo…</h1>
            <p className="text-[var(--muted-foreground)]">This takes a moment.</p>
          </>
        )}
      </div>
    </div>
  );
}
