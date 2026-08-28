import {
  BadRequestException,
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { InAppNotificationsService } from "./in-app-notifications.service";
import { ListNotificationsDto } from "./in-app-notifications.dto";
import { AuthGuard, paginatedResponse } from "../common";
import type { AuthenticatedRequest } from "../common/types/authenticated-request";

// AuthGuard is not global — every controller opts in. This one never did, so
// anonymous requests reached the handlers and were only ever stopped by
// req.user being undefined and crashing.
@Controller("notifications")
@UseGuards(AuthGuard)
export class InAppNotificationsController {
  constructor(private readonly inApp: InAppNotificationsService) {}

  /**
   * Notifications are organization-scoped, but a session has no active
   * organization between sign-in and the web app's set-active call, and
   * API-only clients may never set one. Reads answer "nothing" in that
   * window; writes say so rather than pretending to have done something.
   */
  private orgIdOrNull(req: AuthenticatedRequest): string | null {
    return req.organization?.id ?? null;
  }

  private requireOrgId(req: AuthenticatedRequest): string {
    const orgId = this.orgIdOrNull(req);
    if (!orgId) throw new BadRequestException("No active organization");
    return orgId;
  }

  @Get()
  list(@Query() dto: ListNotificationsDto, @Req() req: AuthenticatedRequest) {
    const orgId = this.orgIdOrNull(req);
    if (!orgId) return paginatedResponse([], 0, dto.page ?? 1, dto.limit ?? 10);

    return this.inApp.findByUser(req.user.id, orgId, dto.page, dto.limit);
  }

  @Get("unread-count")
  async unreadCount(@Req() req: AuthenticatedRequest) {
    const orgId = this.orgIdOrNull(req);
    if (!orgId) return { count: 0 };

    const count = await this.inApp.unreadCount(req.user.id, orgId);
    return { count };
  }

  @Patch("read-all")
  markAllRead(@Req() req: AuthenticatedRequest) {
    return this.inApp.markAllRead(req.user.id, this.requireOrgId(req));
  }

  @Patch(":id/read")
  markRead(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.inApp.markRead(id, req.user.id, this.requireOrgId(req));
  }
}
