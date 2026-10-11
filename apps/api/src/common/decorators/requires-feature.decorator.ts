import { SetMetadata } from "@nestjs/common";
import type { PlanFeature } from "@atrium/shared";

export const PLAN_FEATURE_KEY = "planFeature";
export const RequiresFeature = (feature: PlanFeature) =>
  SetMetadata(PLAN_FEATURE_KEY, feature);
