"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { enableSentry } from "@/lib/sentry";

export function TelemetryConsentBanner() {
  const [dismissed, setDismissed] = useState(false);

  async function handleAccept() {
    await apiFetch("/settings", {
      method: "PATCH",
      body: JSON.stringify({ telemetryEnabled: true }),
    });
    enableSentry();
    setDismissed(true);
  }

  async function handleDecline() {
    await apiFetch("/settings", {
      method: "PATCH",
      body: JSON.stringify({ telemetryEnabled: false }),
    });
    setDismissed(true);
  }

  if (dismissed) return null;

  return (
    <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--foreground)]">Help improve Atrium</p>
        <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
          Share anonymous crash reports and error data with the Atrium team to help us fix bugs and improve the product. No personal data or client information is ever included.
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={handleDecline}
          className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
        >
          No thanks
        </button>
        <button
          onClick={handleAccept}
          className="px-3 py-1.5 text-sm rounded-md bg-[var(--primary)] text-white hover:opacity-90 transition-opacity"
        >
          Share anonymously
        </button>
      </div>
    </div>
  );
}
