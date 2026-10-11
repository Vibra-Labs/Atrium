import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import type { PlanFeature } from "@atrium/shared";
import { PLAN_LIMIT_KEY, PlanLimitResource } from "../decorators/plan-limit.decorator";
import { PLAN_FEATURE_KEY } from "../decorators/requires-feature.decorator";
import { BillingService } from "../../billing/billing.service";
import { planLimitMessage } from "../helpers/plan-limit";
import { planFeatureMessage, planHasFeature } from "../helpers/plan-feature";

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private config: ConfigService,
    private billingService: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const resource = this.reflector.getAllAndOverride<PlanLimitResource | undefined>(PLAN_LIMIT_KEY, targets);
    const feature = this.reflector.getAllAndOverride<PlanFeature | undefined>(PLAN_FEATURE_KEY, targets);

    // No @PlanLimit or @RequiresFeature decorator → pass through
    if (!resource && !feature) return true;

    // Self-hosted mode → no billing enforcement
    if (this.config.get("BILLING_ENABLED", "false") !== "true") return true;

    const request = context.switchToHttp().getRequest();
    const orgId: string | undefined = request.organization?.id;

    // No org context (public route, etc.) → pass through
    if (!orgId) return true;

    const subscription = await this.billingService.getSubscription(orgId);

    // No subscription record → pass through (shouldn't happen if billing initialized)
    if (!subscription) return true;

    if (feature && !planHasFeature(subscription.plan, feature)) {
      throw new ForbiddenException(planFeatureMessage(feature));
    }

    if (resource) {
      const usage = await this.billingService.getUsage(orgId);
      const message: string | null = planLimitMessage(subscription.plan, usage, resource);
      if (message) throw new ForbiddenException(message);
    }

    return true;
  }
}
