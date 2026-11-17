"use client";

import { useState } from "react";
import { Building2, FlaskConical, RotateCcw, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { trackDemoCta } from "@/lib/demo-tracking";

/**
 * Tells a demo visitor where they are, and offers the two things they are most
 * likely to want next: the client's side of the same workspace, and a real
 * account.
 */
export function DemoBanner({
  surface,
  isDemo,
  appUrl = "",
}: {
  surface: "dashboard" | "portal";
  isDemo: boolean;
  /** The real app's origin; the demo runs on its own host. */
  appUrl?: string;
}): React.ReactElement | null {
  const [resetting, setResetting] = useState(false);
  if (!isDemo) return null;

  // "Start free" links back to the real app, tagged so the demo's own
  // conversions are attributable across the two hosts.
  const signupHref = `${appUrl}/signup?ref=demo`;

  async function reset(): Promise<void> {
    setResetting(true);
    try {
      await apiFetch("/demo/reset", { method: "POST" });
      window.location.reload();
    } catch (error) {
      console.error("Demo reset failed", error);
      setResetting(false);
    }
  }

  return (
    <div
      data-testid="demo-banner"
      className="mb-6 p-3 rounded-lg border border-[var(--border)] bg-[var(--muted)] flex flex-col sm:flex-row sm:items-center gap-2 text-sm"
    >
      <div className="flex items-center gap-2 flex-1">
        <FlaskConical size={14} className="shrink-0 text-[var(--primary)]" />
        <span>
          You&apos;re exploring a shared demo. Everything here is made up, and it resets every
          30 minutes.
        </span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {/* The flip works both ways. Landing in the portal with no way back to
            the agency side made the client view a dead end you had to know how
            to leave. */}
        {surface === "dashboard" ? (
          <a
            href="/demo/client"
            onClick={() => trackDemoCta("client_view")}
            className="inline-flex items-center gap-1 hover:underline"
          >
            <Users size={13} /> See the client view
          </a>
        ) : (
          <a
            href="/demo"
            onClick={() => trackDemoCta("agency_view")}
            className="inline-flex items-center gap-1 hover:underline"
          >
            <Building2 size={13} /> Back to the agency view
          </a>
        )}
        <button
          type="button"
          onClick={reset}
          disabled={resetting}
          className="inline-flex items-center gap-1 hover:underline disabled:opacity-60"
        >
          <RotateCcw size={13} /> {resetting ? "Resetting…" : "Reset demo"}
        </button>
        <a
          href={signupHref}
          onClick={() => trackDemoCta("start_free")}
          data-testid="demo-start-free"
          className="px-3 py-1.5 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] font-medium"
        >
          Start free
        </a>
      </div>
    </div>
  );
}
