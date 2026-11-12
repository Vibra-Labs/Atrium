"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@/lib/track";
import { useToast } from "@/components/toast";
import {
  INVITE_SENT_EVENT,
  loadDueOffer,
  offerCheckout,
  recordOffer,
  type CheckoutPlan,
  type DueOffer,
  type PlanOfferKind,
  type PlanOfferOutcome,
} from "@/lib/plan-offers";
import { PlanOfferModal } from "./plan-offer-modal";
import { UsageOfferCard } from "./usage-offer-card";

const DIALOG_POLL_MS: number = 1000;
const DIALOG_WAIT_LIMIT_MS: number = 120_000;

/** Resolves once no other dialog is open, so an offer never covers a form. */
async function waitForNoDialog(): Promise<boolean> {
  const started: number = Date.now();
  while (document.querySelector('[role="dialog"]')) {
    if (Date.now() - started > DIALOG_WAIT_LIMIT_MS) return false;
    await new Promise((resolve) => setTimeout(resolve, DIALOG_POLL_MS));
  }
  return true;
}

function remember(kind: PlanOfferKind, outcome: PlanOfferOutcome): void {
  recordOffer(kind, outcome).catch((err: unknown) => console.error(`Failed to record plan offer ${outcome}`, err));
}

/**
 * Shows the plan offer the server says is due. Rendered for owners only; the API
 * also refuses everyone else and answers "none" on self-hosted installs.
 */
export function PlanOfferHost(): React.ReactElement | null {
  const [due, setDue] = useState<DueOffer | null>(null);
  const [busySlug, setBusySlug] = useState<CheckoutPlan | null>(null);
  const shownRef = useRef<boolean>(false);
  const { error: showError } = useToast();

  const check = useCallback(async (): Promise<void> => {
    if (shownRef.current) return;
    try {
      const next: DueOffer = await loadDueOffer();
      if (!next.offer || shownRef.current) return;
      if (!(await waitForNoDialog()) || shownRef.current) return;
      shownRef.current = true;
      setDue(next);
      remember(next.offer, "shown");
      track("plan_offer_shown", { offer: next.offer });
    } catch (err) {
      console.error("Failed to check for a plan offer", err);
    }
  }, []);

  useEffect(() => {
    void check();
    const onInvite = (): void => void check();
    window.addEventListener(INVITE_SENT_EVENT, onInvite);
    return () => window.removeEventListener(INVITE_SENT_EVENT, onInvite);
  }, [check]);

  if (!due?.offer) return null;
  const offer: PlanOfferKind = due.offer;

  const dismiss = (): void => {
    remember(offer, "dismissed");
    track("plan_offer_dismissed", { offer });
    setDue(null);
  };

  const choose = async (slug: CheckoutPlan): Promise<void> => {
    setBusySlug(slug);
    track("plan_offer_checkout_started", { offer, plan: slug });
    try {
      await recordOffer(offer, "checkout");
    } catch (err) {
      console.error("Failed to record plan offer checkout", err);
    }
    try {
      await offerCheckout(slug);
    } catch (err) {
      console.error("Failed to start checkout from a plan offer", err);
      showError(err instanceof Error ? err.message : "Could not start checkout");
      setBusySlug(null);
    }
  };

  if (offer === "usage") {
    return (
      <UsageOfferCard
        activity={due.activity ?? { sharedProjects: 0, clients: 0, updates: 0 }}
        busySlug={busySlug}
        onChoose={(slug: CheckoutPlan) => void choose(slug)}
        onDismiss={dismiss}
      />
    );
  }
  return (
    <PlanOfferModal
      offer={offer}
      busySlug={busySlug}
      onChoose={(slug: CheckoutPlan) => void choose(slug)}
      onSkip={dismiss}
    />
  );
}
