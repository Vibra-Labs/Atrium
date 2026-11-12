import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { PlanOffersController } from "./plan-offers.controller";
import { PlanOffersService } from "./plan-offers.service";

@Module({
  imports: [BillingModule],
  controllers: [PlanOffersController],
  providers: [PlanOffersService],
  exports: [PlanOffersService],
})
export class PlanOffersModule {}
