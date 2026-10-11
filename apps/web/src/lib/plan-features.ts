import { useEffect, useState } from "react";
import { PLAN_FEATURES, type PlanFeature } from "@atrium/shared";
import { apiFetch } from "@/lib/api";

export type PlanFeatures = Record<PlanFeature, boolean>;

interface PlanState {
  features: PlanFeatures;
  /** ISO date the Pro trial ends, or null when not trialing. */
  trialEndsAt: string | null;
}

// The API enforces every gate, so if the lookup fails we show the feature
// rather than locking the UI on a network blip.
const FALLBACK: PlanState = {
  features: Object.fromEntries(PLAN_FEATURES.map((f) => [f, true])) as PlanFeatures,
  trialEndsAt: null,
};

let cache: PlanState | null = null;
let pending: Promise<PlanState> | null = null;

function fetchPlanState(): Promise<PlanState> {
  if (!pending) {
    pending = apiFetch<PlanState>("/billing/features")
      .then((data) => {
        cache = data;
        return data;
      })
      .catch((err: unknown) => {
        console.error("Failed to load plan features", err);
        pending = null;
        return FALLBACK;
      });
  }
  return pending;
}

/** Forget the cached plan so the next render reads the newly active workspace. */
export function resetPlanState(): void {
  cache = null;
  pending = null;
}

function usePlanState(): PlanState | null {
  const [state, setState] = useState<PlanState | null>(cache);

  useEffect(() => {
    if (cache) return;
    fetchPlanState().then(setState);
  }, []);

  return state;
}

/** Which Pro features the current workspace can use. Null while loading. */
export function usePlanFeatures(): PlanFeatures | null {
  return usePlanState()?.features ?? null;
}

/** When the workspace's Pro trial ends, or null if it isn't trialing (or still loading). */
export function useTrialEndsAt(): Date | null {
  const iso: string | null = usePlanState()?.trialEndsAt ?? null;
  return iso ? new Date(iso) : null;
}

/** True while the workspace is on its no-card Pro trial. */
export function useIsTrialing(): boolean {
  return useTrialEndsAt() !== null;
}

/** Whole days left, rounded up so the last day reads "1 day left". */
export function trialDaysLeft(endsAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
}
