import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import { InAppNotificationsService } from "./in-app-notifications.service";
import { ListNotificationsDto } from "./in-app-notifications.dto";

@Controller("notifications")
export class InAppNotificationsController {
  constructor(private readonly inApp: InAppNotificationsService) {}

  @Get()
  list(@Query() dto: ListNotificationsDto, @Req() req: any) {
    return this.inApp.findByUser(
      req.user.id,
      req.organization.id,
      dto.page,
      dto.limit,
    );
  }

  @Get("unread-count")
  async unreadCount(@Req() req: any) {
    const count = await this.inApp.unreadCount(
      req.user.id,
      req.organization.id,
    );
    return { count };
  }

  @Patch("read-all")
  markAllRead(@Req() req: any) {
    return this.inApp.markAllRead(req.user.id, req.organization.id);
  }

  @Patch(":id/read")
  markRead(@Param("id") id: string, @Req() req: any) {
    return this.inApp.markRead(id, req.user.id, req.organization.id);
  }
}
