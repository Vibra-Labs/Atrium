import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SettingsModule } from "../settings/settings.module";
import { PaymentsController } from "./payments.controller";
import { ConnectWebhookController } from "./connect-webhook.controller";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [BillingModule, NotificationsModule, SettingsModule],
  controllers: [PaymentsController, ConnectWebhookController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
