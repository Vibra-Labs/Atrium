import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { FilesModule } from "../files/files.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ActivityModule } from "../activity/activity.module";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { DocumentAuditService } from "./document-audit.service";
import { DocumentExpiryTask } from "./document-expiry.task";
import { DocumentReminderTask } from "./document-reminder.task";
import { DocumentTokenCleanupTask } from "./document-token-cleanup.task";

@Module({
  imports: [ScheduleModule.forRoot(), FilesModule, NotificationsModule, ActivityModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentAuditService,
    DocumentExpiryTask,
    DocumentReminderTask,
    DocumentTokenCleanupTask,
  ],
})
export class DocumentsModule {}
