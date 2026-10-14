import { useEffect, useSyncExternalStore } from "react";
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
// Bumped on reset so a response for the previous workspace is ignored.
let generation = 0;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** The cached plan, or null until it has been loaded. */
export function getPlanSnapshot(): PlanState | null {
  return cache;
}

export function subscribePlanState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Load the plan once; concurrent callers share the request. */
export function loadPlanState(): Promise<PlanState> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    const requested: number = generation;
    pending = apiFetch<PlanState>("/billing/features")
      .catch((err: unknown) => {
        console.error("Failed to load plan features", err);
        return FALLBACK;
      })
      .then((data) => {
        if (requested !== generation) return data; // workspace changed meanwhile
        cache = data;
        pending = null;
        notify();
        return data;
      });
  }
  return pending;
}

/** Forget the cached plan so every subscriber re-reads the newly active workspace. */
export function resetPlanState(): void {
  cache = null;
  pending = null;
  generation++;
  notify();
}

function usePlanState(): PlanState | null {
  const state: PlanState | null = useSyncExternalStore(subscribePlanState, getPlanSnapshot, () => null);

  useEffect(() => {
    if (!state) void loadPlanState();
  }, [state]);

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
