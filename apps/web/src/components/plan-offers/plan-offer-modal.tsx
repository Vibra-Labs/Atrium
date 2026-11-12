"use client";

import { PlanPicker } from "./plan-picker";
import type { CheckoutPlan, PlanOfferKind } from "@/lib/plan-offers";

type ModalOffer = Exclude<PlanOfferKind, "usage">;

const COPY: Record<ModalOffer, { title: string; body: string; skip: string }> = {
  early: {
    title: "Choose your plan",
    body: "Your Pro trial is running. Pick a plan now, or keep trying everything for free.",
    skip: "Keep my free trial",
  },
  trial_end: {
    title: "Your Pro trial has ended",
    body: "You're on the Free plan now. Pick a plan to get custom domains, e-signatures, online payments and white-label back.",
    skip: "Continue on Free",
  },
  free: {
    title: "Choose your plan",
    body: "You're on the Free plan. Upgrade for custom domains, e-signatures, online payments and white-label.",
    skip: "Continue on Free",
  },
};

interface PlanOfferModalProps {
  offer: ModalOffer;
  busySlug: CheckoutPlan | null;
  onChoose: (slug: CheckoutPlan) => void;
  onSkip: () => void;
}

export function PlanOfferModal({ offer, busySlug, onChoose, onSkip }: PlanOfferModalProps): React.ReactElement {
  const copy = COPY[offer];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-offer-title"
        data-testid="plan-offer"
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--background)] border border-[var(--border)] p-6 space-y-5"
      >
        <div className="space-y-1 text-center">
          <h2 id="plan-offer-title" className="text-xl font-bold">
            {copy.title}
          </h2>
          <p className="text-sm text-[var(--muted-foreground)]">{copy.body}</p>
        </div>
        <PlanPicker onChoose={onChoose} busySlug={busySlug} />
        <div className="text-center">
          <button
            type="button"
            onClick={onSkip}
            disabled={busySlug !== null}
            className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline"
          >
            {copy.skip}
          </button>
        </div>
      </div>
    </div>
  );
}
