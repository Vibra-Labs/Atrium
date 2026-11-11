import { Body, Controller, Delete, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import type { ProjectStatus } from "@atrium/database";
import { AuthGuard, RolesGuard, Roles, CurrentOrg } from "../common";
import { ProjectStatusesService } from "./project-statuses.service";
import { CreateProjectStatusDto, ReorderProjectStatusesDto, UpdateProjectStatusDto } from "./project-statuses.dto";

/** Editing a workspace's project statuses. Reading them stays at GET /projects/statuses. */
@Controller("project-statuses")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class ProjectStatusesController {
  constructor(private statuses: ProjectStatusesService) {}

  @Post()
  create(@Body() dto: CreateProjectStatusDto, @CurrentOrg("id") orgId: string): Promise<ProjectStatus> {
    return this.statuses.create(dto, orgId);
  }

  @Put("order")
  reorder(@Body() dto: ReorderProjectStatusesDto, @CurrentOrg("id") orgId: string): Promise<ProjectStatus[]> {
    return this.statuses.reorder(dto, orgId);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateProjectStatusDto,
    @CurrentOrg("id") orgId: string,
  ): Promise<ProjectStatus> {
    return this.statuses.update(id, dto, orgId);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @Query("moveTo") moveTo: string = "", @CurrentOrg("id") orgId: string): Promise<void> {
    return this.statuses.remove(id, moveTo, orgId);
  }
}
