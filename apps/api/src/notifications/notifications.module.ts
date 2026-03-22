import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module";
import { NotificationsService } from "./notifications.service";
import { InAppNotificationsService } from "./in-app-notifications.service";
import { InAppNotificationsController } from "./in-app-notifications.controller";
import { PushService } from "./push.service";
import { PushController } from "./push.controller";

@Module({
  imports: [MailModule],
  controllers: [InAppNotificationsController, PushController],
  providers: [NotificationsService, InAppNotificationsService, PushService],
  exports: [NotificationsService, InAppNotificationsService, PushService],
})
export class NotificationsModule {}
