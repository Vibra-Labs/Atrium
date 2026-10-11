import { Module } from "@nestjs/common";
import { FilesModule } from "../files/files.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ActivityModule } from "../activity/activity.module";
import { UpdatesController } from "./updates.controller";
import { UpdatesService } from "./updates.service";
import { WeeklyUpdatesService } from "./weekly-updates.service";
import { WeeklyReminderTask } from "./weekly-reminder.task";
import { MailModule } from "../mail/mail.module";

@Module({
  imports: [FilesModule, NotificationsModule, ActivityModule, MailModule],
  controllers: [UpdatesController],
  providers: [UpdatesService, WeeklyUpdatesService, WeeklyReminderTask],
  exports: [UpdatesService],
})
export class UpdatesModule {}
