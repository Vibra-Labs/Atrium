import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { SettingsModule } from "../settings/settings.module";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";
import { IntegrationDispatcher } from "./integration-dispatcher.service";
import { IntegrationsTask } from "./integrations.task";

@Module({
  imports: [SettingsModule, BillingModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationDispatcher, IntegrationsTask],
  exports: [IntegrationDispatcher],
})
export class IntegrationsModule {}
