import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";
import { BillingModule } from "../billing/billing.module";

@Module({
  imports: [ConfigModule, BillingModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
