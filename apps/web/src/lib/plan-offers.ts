import { apiFetch } from "@/lib/api";

export type PlanOfferKind = "early" | "usage" | "trial_end" | "free";
export type PlanOfferOutcome = "shown" | "dismissed" | "checkout";
export type CheckoutPlan = "pro" | "lifetime";

export interface WorkspaceActivity {
  sharedProjects: number;
  clients: number;
  updates: number;
}

export interface OfferPricing {
  proMonthlyCents: number;
  /** False when Lifetime is sold out or switched off. */
  lifetimeAvailable: boolean;
}

export interface DueOffer {
  offer: PlanOfferKind | null;
  activity: WorkspaceActivity | null;
  pricing: OfferPricing | null;
}

/** Fired after an invite goes out, so a due plan offer can show right away. */
export const INVITE_SENT_EVENT: string = "atrium:invite-sent";

export function notifyInviteSent(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(INVITE_SENT_EVENT));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The usage card's line, worded around what the workspace has done. */
export function usageOfferText(activity: WorkspaceActivity, pricing: OfferPricing): string {
  const lead: string =
    activity.sharedProjects > 0 && activity.clients > 0
      ? `You've shared ${plural(activity.sharedProjects, "project")} with ${plural(activity.clients, "client")}.`
      : "You've been putting Atrium to work this week.";
  const pro: string = `Keep Pro for $${(pricing.proMonthlyCents / 100).toFixed(0)}/mo`;
  return pricing.lifetimeAvailable ? `${lead} ${pro}, or get Lifetime while seats last.` : `${lead} ${pro}.`;
}

export function loadDueOffer(): Promise<DueOffer> {
  return apiFetch<DueOffer>("/plan-offers/due");
}

/** For "shown", `claimed` is false when another tab already showed an offer. */
export function recordOffer(kind: PlanOfferKind, outcome: PlanOfferOutcome): Promise<{ claimed: boolean }> {
  return apiFetch<{ claimed: boolean }>(`/plan-offers/${kind}`, { method: "POST", body: JSON.stringify({ outcome }) });
}

/** Starts Stripe checkout for the plan and leaves the page. */
export async function offerCheckout(planSlug: CheckoutPlan): Promise<void> {
  const result = await apiFetch<{ url: string }>("/billing/checkout", {
    method: "POST",
    body: JSON.stringify({
      planSlug,
      successUrl: `${window.location.origin}/dashboard/settings/billing?success=true`,
      cancelUrl: window.location.href,
    }),
  });
  if (result.url) window.location.href = result.url;
}

/** "Free", "$29/mo" or "$499 once". Free is stored as one-time, so price decides first. */
export function planPriceLabel(plan: { isRecurring: boolean; priceMonthly: number; priceLifetime: number }): string {
  const cents: number = plan.isRecurring ? plan.priceMonthly : plan.priceLifetime;
  if (cents <= 0) return "Free";
  const dollars: string = `$${(cents / 100).toFixed(0)}`;
  return plan.isRecurring ? `${dollars}/mo` : `${dollars} once`;
}
