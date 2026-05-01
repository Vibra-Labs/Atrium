import { Module } from "@nestjs/common";
import { TwoFactorController } from "./two-factor.controller";
import { TwoFactorService } from "./two-factor.service";
import { TwoFactorEnforcementGuard } from "./two-factor-enforcement.guard";

@Module({
  controllers: [TwoFactorController],
  providers: [TwoFactorService, TwoFactorEnforcementGuard],
  exports: [TwoFactorService, TwoFactorEnforcementGuard],
})
export class TwoFactorModule {}
