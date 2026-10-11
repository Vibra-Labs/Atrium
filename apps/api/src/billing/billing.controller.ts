import { Controller, Get, Post, Body, UseGuards } from "@nestjs/common";
import { BillingService } from "./billing.service";
import { CreateCheckoutDto, CreatePortalDto } from "./billing.dto";
import { AuthGuard, RolesGuard, Roles, CurrentOrg, Public } from "../common";

@Controller("billing")
@UseGuards(AuthGuard, RolesGuard)
export class BillingController {
  constructor(private billingService: BillingService) {}

  @Get("plans")
  @Public()
  async getPlans() {
    const [plans, lifetimeSeatsRemaining] = await Promise.all([
      this.billingService.getPlans(),
      this.billingService.getLifetimeSeatsRemaining(),
    ]);
    return { plans, lifetimeSeatsRemaining };
  }

  @Get("subscription")
  @Roles("owner", "admin")
  async getSubscription(@CurrentOrg("id") orgId: string) {
    const [subscription, usage] = await Promise.all([
      this.billingService.getSubscription(orgId),
      this.billingService.getUsage(orgId),
    ]);
    return { subscription, usage };
  }

  // Any member, including clients: the web app uses this to show locks and the portal badge.
  @Get("features")
  async getFeatures(@CurrentOrg("id") orgId: string) {
    return this.billingService.getPlanState(orgId);
  }

  @Post("checkout")
  @Roles("owner", "admin")
  async createCheckout(
    @Body() dto: CreateCheckoutDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.billingService.createCheckoutSession(
      orgId,
      dto.planSlug,
      dto.successUrl,
      dto.cancelUrl,
    );
  }

  @Post("portal")
  @Roles("owner", "admin")
  async createPortal(
    @Body() dto: CreatePortalDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.billingService.createPortalSession(orgId, dto.returnUrl);
  }
}
