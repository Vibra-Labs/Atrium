import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, RolesGuard, Roles, CurrentOrg } from "../common";
import { CalendarService } from "./calendar.service";
import { CalendarQueryDto } from "./calendar.dto";

@Controller("calendar")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class CalendarController {
  constructor(private service: CalendarService) {}

  @Get()
  list(@CurrentOrg("id") orgId: string, @Query() q: CalendarQueryDto) {
    return this.service.list(orgId, q);
  }
}
