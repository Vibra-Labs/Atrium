import { Module } from "@nestjs/common";
import { FilesModule } from "../files/files.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ActivityModule } from "../activity/activity.module";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";

@Module({
  imports: [FilesModule, NotificationsModule, ActivityModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
