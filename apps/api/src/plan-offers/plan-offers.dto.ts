import { IsIn } from "class-validator";
import type { PlanOfferOutcome } from "./plan-offers.service";

export class RecordPlanOfferDto {
  @IsIn(["shown", "dismissed", "checkout"])
  outcome: PlanOfferOutcome;
}
