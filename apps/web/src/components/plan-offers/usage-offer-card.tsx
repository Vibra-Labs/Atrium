"use client";

import { Sparkles, X } from "lucide-react";
import { usageOfferText, type CheckoutPlan, type WorkspaceActivity } from "@/lib/plan-offers";

interface UsageOfferCardProps {
  activity: WorkspaceActivity;
  busySlug: CheckoutPlan | null;
  onChoose: (slug: CheckoutPlan) => void;
  onDismiss: () => void;
}

/** A lighter, second ask: the owner already said "not yet" once. */
export function UsageOfferCard({ activity, busySlug, onChoose, onDismiss }: UsageOfferCardProps): React.ReactElement {
  return (
    <div
      data-testid="usage-offer"
      className="mb-6 p-4 rounded-lg border border-[var(--primary)]/30 bg-[var(--muted)] flex flex-col sm:flex-row sm:items-center gap-3 text-sm"
    >
      <div className="flex items-start gap-2 flex-1">
        <Sparkles size={15} className="shrink-0 mt-0.5 text-[var(--primary)]" />
        <span>{usageOfferText(activity)}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          disabled={busySlug !== null}
          onClick={() => onChoose("pro")}
          className="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white font-medium hover:opacity-90 disabled:opacity-50"
        >
          Keep Pro
        </button>
        <button
          type="button"
          disabled={busySlug !== null}
          onClick={() => onChoose("lifetime")}
          className="px-3 py-1.5 rounded-lg border border-[var(--border)] font-medium hover:bg-[var(--background)] disabled:opacity-50"
        >
          Get Lifetime
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
