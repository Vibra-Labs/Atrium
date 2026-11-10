import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import type { PursuitStage } from "@atrium/database";
import { AuthGuard, RolesGuard, Roles, CurrentOrg } from "../common";
import { PursuitStagesService } from "./pursuit-stages.service";
import { CreatePursuitStageDto, RenamePursuitStageDto, ReorderPursuitStagesDto } from "./pursuit-stages.dto";

@Controller("pursuit-stages")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class PursuitStagesController {
  constructor(private stages: PursuitStagesService) {}

  @Get()
  findAll(@CurrentOrg("id") orgId: string): Promise<PursuitStage[]> {
    return this.stages.findAll(orgId);
  }

  @Post()
  create(@Body() dto: CreatePursuitStageDto, @CurrentOrg("id") orgId: string): Promise<PursuitStage> {
    return this.stages.create(dto, orgId);
  }

  @Put("order")
  reorder(@Body() dto: ReorderPursuitStagesDto, @CurrentOrg("id") orgId: string): Promise<PursuitStage[]> {
    return this.stages.reorder(dto, orgId);
  }

  @Patch(":id")
  rename(
    @Param("id") id: string,
    @Body() dto: RenamePursuitStageDto,
    @CurrentOrg("id") orgId: string,
  ): Promise<PursuitStage> {
    return this.stages.rename(id, dto, orgId);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @Query("moveTo") moveTo: string = "", @CurrentOrg("id") orgId: string): Promise<void> {
    return this.stages.remove(id, moveTo, orgId);
  }
}
