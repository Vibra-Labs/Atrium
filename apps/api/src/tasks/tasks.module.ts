import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { ActivityModule } from "../activity/activity.module";
import { TimeEntriesModule } from "../time-entries/time-entries.module";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

@Module({
  imports: [NotificationsModule, ActivityModule, TimeEntriesModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
