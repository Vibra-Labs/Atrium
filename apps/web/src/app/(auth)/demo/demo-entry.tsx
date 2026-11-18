"use client";

import { useEffect, useRef } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export type DemoKind = "owner" | "client";

/**
 * Sends the visitor into the demo.
 *
 * A form that submits itself, rather than fetch(). The entry endpoint answers
 * with a redirect chain — sign-in link, then back to the app — that ends on a
 * different origin from the API, and a cross-origin fetch cannot follow a
 * redirect to an origin that answers without CORS headers; it fails with a bare
 * "Failed to fetch". A top-level form navigation is not subject to CORS at all,
 * and it carries the session cookies the chain sets.
 *
 * It must stay a POST: prefetchers, mail scanners and chat-app link previews
 * all fetch GET links, and each fetch would spend a sign-in link and count as a
 * visit that never happened.
 */
export function DemoEntry({ kind }: { kind: DemoKind }): React.ReactElement {
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    form.current?.submit();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form
        ref={form}
        method="POST"
        action={`${API_URL}/api/demo/enter?kind=${kind}`}
        className="w-full max-w-sm space-y-4 text-center"
      >
        <h1 className="text-2xl font-bold">Opening the demo…</h1>
        <p className="text-[var(--muted-foreground)]">This takes a moment.</p>
        {/* Visible only if the automatic submit has not happened yet. */}
        <button
          type="submit"
          className="text-[var(--primary)] hover:underline"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
