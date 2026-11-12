import { apiFetch } from "@/lib/api";

export type PlanOfferKind = "early" | "usage" | "trial_end" | "free";
export type PlanOfferOutcome = "shown" | "dismissed" | "checkout";
export type CheckoutPlan = "pro" | "lifetime";

export interface WorkspaceActivity {
  sharedProjects: number;
  clients: number;
  updates: number;
}

export interface DueOffer {
  offer: PlanOfferKind | null;
  activity: WorkspaceActivity | null;
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
export function usageOfferText(activity: WorkspaceActivity): string {
  const lead: string =
    activity.sharedProjects > 0 && activity.clients > 0
      ? `You've shared ${plural(activity.sharedProjects, "project")} with ${plural(activity.clients, "client")}.`
      : "You've been putting Atrium to work this week.";
  return `${lead} Keep Pro for $29/mo, or get Lifetime while seats last.`;
}

export function loadDueOffer(): Promise<DueOffer> {
  return apiFetch<DueOffer>("/plan-offers/due");
}

export function recordOffer(kind: PlanOfferKind, outcome: PlanOfferOutcome): Promise<void> {
  return apiFetch<void>(`/plan-offers/${kind}`, { method: "POST", body: JSON.stringify({ outcome }) });
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
