import { PLAN_FEATURE_LABELS, type PlanFeature } from "@atrium/shared";

const FREE_PLAN_SLUG = "free";

/** Every paid plan includes every Pro feature; only the free plan is restricted. */
export function planHasFeature(plan: { slug: string }, _feature: PlanFeature): boolean {
  return plan.slug !== FREE_PLAN_SLUG;
}

export function planFeatureMessage(feature: PlanFeature): string {
  return `${PLAN_FEATURE_LABELS[feature]} are available on paid plans. Please upgrade to continue.`;
}
