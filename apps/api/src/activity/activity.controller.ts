import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, OrgRoleGuard, Roles, CurrentOrg } from "../auth";
import { ActivityService } from "./activity.service";

@Controller("activity")
@UseGuards(JwtAuthGuard, OrgRoleGuard)
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get()
  @Roles("owner", "admin", "member")
  findAll(
    @CurrentOrg("id") orgId: string,
    @Query("limit") limit?: string,
  ) {
    const numLimit = limit ? Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50) : 10;
    return this.activityService.findByOrg(orgId, numLimit);
  }
}
