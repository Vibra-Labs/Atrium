import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, RolesGuard, Roles, CurrentOrg } from "../common";
import { PlanOffersService, type DueOffer } from "./plan-offers.service";
import { PLAN_OFFER_KINDS, type PlanOfferKind } from "./decide-plan-offer";
import { RecordPlanOfferDto } from "./plan-offers.dto";

// Owner only: admins, team members and clients are never offered a plan.
@Controller("plan-offers")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner")
export class PlanOffersController {
  constructor(private planOffers: PlanOffersService) {}

  @Get("due")
  async due(@CurrentOrg("id") orgId: string): Promise<DueOffer> {
    return this.planOffers.due(orgId);
  }

  /** For "shown", `claimed` says whether this tab may display the offer. */
  @Post(":kind")
  @HttpCode(200)
  async record(
    @CurrentOrg("id") orgId: string,
    @Param("kind") kind: string,
    @Body() dto: RecordPlanOfferDto,
  ): Promise<{ claimed: boolean }> {
    if (!PLAN_OFFER_KINDS.includes(kind as PlanOfferKind)) throw new BadRequestException("Unknown plan offer");
    return this.planOffers.record(orgId, kind as PlanOfferKind, dto.outcome);
  }
}
