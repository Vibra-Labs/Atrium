import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { LeadSourcesService } from "./lead-sources.service";
import { LeadSourceDto } from "./contacts.dto";
import { AuthGuard, RolesGuard, Roles, CurrentOrg } from "../common";

@Controller("lead-sources")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class LeadSourcesController {
  constructor(private leadSources: LeadSourcesService) {}

  @Get()
  findAll(@CurrentOrg("id") orgId: string) {
    return this.leadSources.findAll(orgId);
  }

  @Post()
  create(@Body() dto: LeadSourceDto, @CurrentOrg("id") orgId: string) {
    return this.leadSources.create(dto, orgId);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() dto: LeadSourceDto, @CurrentOrg("id") orgId: string) {
    return this.leadSources.update(id, dto, orgId);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentOrg("id") orgId: string) {
    return this.leadSources.remove(id, orgId);
  }
}
