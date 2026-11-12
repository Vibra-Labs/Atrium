import { DAY_MS } from "../common/helpers/local-time";

export type PlanOfferKind = "early" | "usage" | "trial_end" | "free";

export const PLAN_OFFER_KINDS: PlanOfferKind[] = ["early", "usage", "trial_end", "free"];

export interface PlanOfferState {
  clientInvitedAt: Date | null;
  activeDays: number;
  lastOfferDay: string | null;
  earlyShownAt: Date | null;
  usageShownAt: Date | null;
  finalShownAt: Date | null;
}

export interface PlanOfferInput {
  now: Date;
  billingEnabled: boolean;
  /** When the workspace was created. */
  signupAt: Date;
  /** "trial" is an app-managed trial; "paid" is any plan other than Free outside a trial. */
  plan: "free" | "trial" | "paid";
  trialEndsAt: Date | null;
  trialEndedAt: Date | null;
  state: PlanOfferState;
}

// Offers 1 and 2 give way to the trial emails and the trial-end screen this close to the end.
const QUIET_DAYS_BEFORE_END: number = 3;
// The usage card waits this long after the early offer, so the two never come back to back.
const DAYS_BETWEEN_OFFERS: number = 2;
const ACTIVE_DAYS_FOR_USAGE: number = 3;
// A trial that ended this recently gets "Your Pro trial has ended"; older ones get the plain Free screen.
const RECENT_TRIAL_END_DAYS: number = 7;

/** The UTC calendar day, e.g. "2026-11-20". */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Which plan offer, if any, the workspace owner should see now. */
export function decidePlanOffer(input: PlanOfferInput): PlanOfferKind | null {
  const { now, state } = input;
  if (!input.billingEnabled || input.plan === "paid") return null;
  if (state.finalShownAt) return null;
  if (state.lastOfferDay === utcDay(now)) return null;

  if (input.plan === "free") {
    const endedRecently: boolean =
      input.trialEndedAt !== null && now.getTime() - input.trialEndedAt.getTime() <= RECENT_TRIAL_END_DAYS * DAY_MS;
    return endedRecently ? "trial_end" : "free";
  }

  if (input.trialEndsAt) {
    const daysLeft: number = Math.ceil((input.trialEndsAt.getTime() - now.getTime()) / DAY_MS);
    if (daysLeft <= QUIET_DAYS_BEFORE_END) return null;
  }

  if (!state.earlyShownAt) {
    const returned: boolean = utcDay(now) !== utcDay(input.signupAt);
    return state.clientInvitedAt || returned ? "early" : null;
  }

  const sinceEarly: number = now.getTime() - state.earlyShownAt.getTime();
  if (!state.usageShownAt && sinceEarly >= DAYS_BETWEEN_OFFERS * DAY_MS && state.activeDays >= ACTIVE_DAYS_FOR_USAGE) {
    return "usage";
  }
  return null;
}
