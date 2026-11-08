import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsIn } from "class-validator";
import { DASHBOARD_WIDGET_KEYS } from "@atrium/shared";
import { AuthGuard, RolesGuard, Roles, CurrentMember } from "../common";
import { DashboardLayoutService, type DashboardLayout } from "./dashboard-layout.service";

export class UpdateDashboardLayoutDto {
  @IsArray()
  @ArrayMaxSize(DASHBOARD_WIDGET_KEYS.length)
  @IsIn(DASHBOARD_WIDGET_KEYS, { each: true })
  hidden!: string[];
}

// The staff dashboard only; clients use the portal.
@Controller("dashboard-layout")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class DashboardLayoutController {
  constructor(private layout: DashboardLayoutService) {}

  @Get()
  get(@CurrentMember("id") memberId: string): Promise<DashboardLayout> {
    return this.layout.get(memberId);
  }

  @Put()
  update(@CurrentMember("id") memberId: string, @Body() dto: UpdateDashboardLayoutDto): Promise<DashboardLayout> {
    return this.layout.update(memberId, dto.hidden);
  }
}
