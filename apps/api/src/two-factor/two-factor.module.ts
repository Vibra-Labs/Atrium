import { Module } from "@nestjs/common";
import { TwoFactorController } from "./two-factor.controller";
import { TwoFactorService } from "./two-factor.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [TwoFactorController],
  providers: [TwoFactorService],
  exports: [TwoFactorService],
})
export class TwoFactorModule {}
