import { Module } from "@nestjs/common";
import { CommentsController } from "./comments.controller";
import { CommentsService } from "./comments.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
