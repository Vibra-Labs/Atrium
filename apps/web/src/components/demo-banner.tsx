"use client";

import { useEffect, useState } from "react";
import { Building2, FlaskConical, Users } from "lucide-react";
import { RESET_CADENCE, resetCountdown } from "@/lib/demo";
import { trackDemoCta } from "@/lib/demo-tracking";

/**
 * Tells a demo visitor where they are, and offers the two things they are most
 * likely to want next: the other side of the same workspace, and an account of
 * their own.
 *
 * There is deliberately no Reset button. Several strangers share this
 * workspace at the same time, so a manual reset is a control that can only do
 * harm — one visitor wipes the place out from under the others mid-click. The
 * countdown says when it happens on its own, which is the part that is
 * actually useful to know.
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
  // Starts on the cadence, not the countdown: the countdown reads the clock, so
  // as initial state it renders one value on the server and another at
  // hydration, and React logs a mismatch warning on every demo page. The live
  // value is set on mount, below.
  const [countdown, setCountdown] = useState<string>(RESET_CADENCE);

  // Ticks so the countdown stays honest on a page left open.
  useEffect(() => {
    setCountdown(resetCountdown());
    const timer = setInterval(() => setCountdown(resetCountdown()), 15_000);
    return () => clearInterval(timer);
  }, []);

  if (!isDemo) return null;

  // "Start free" links back to the real app, tagged so the demo's own
  // conversions are attributable across the two hosts.
  //
  // Dropped entirely when there is no app URL to point at. It used to fall
  // back to a bare `/signup`, which on this host is the demo's own signup
  // page: the visitor would create a real account on a throwaway instance,
  // run the setup wizard, and book Google Ads conversions from it. A missing
  // button is a missing button; a button to the wrong place costs money.
  const signupHref: string | null = appUrl ? `${appUrl}/signup?ref=demo` : null;

  return (
    <div
      data-testid="demo-banner"
      className="mb-6 p-3 rounded-lg border border-[var(--border)] bg-[var(--muted)] flex flex-col sm:flex-row sm:items-center gap-2 text-sm"
    >
      <div className="flex items-center gap-2 flex-1">
        <FlaskConical size={14} className="shrink-0 text-[var(--primary)]" />
        <span>
          You&apos;re exploring a shared demo. Everything here is made up, and it{" "}
          <span className="whitespace-nowrap">resets {countdown}</span>.
        </span>
      </div>
      <div className="flex items-center gap-4 shrink-0">
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
        {signupHref && (
          <a
            href={signupHref}
            onClick={() => trackDemoCta("start_free")}
            data-testid="demo-start-free"
            className="px-3 py-1.5 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] font-medium"
          >
            Start free
          </a>
        )}
      </div>
    </div>
  );
}
