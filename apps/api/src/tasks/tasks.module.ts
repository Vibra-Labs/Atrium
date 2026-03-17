import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { ActivityModule } from "../activity/activity.module";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

@Module({
  imports: [NotificationsModule, ActivityModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
