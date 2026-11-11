import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import type { PursuitPipeline, PursuitStage } from "@atrium/database";
import { AuthGuard, RolesGuard, Roles, CurrentOrg } from "../common";
import { PursuitStagesService } from "./pursuit-stages.service";
import type { PipelineWithStages } from "./pursuit-stages.service";
import {
  CreatePursuitStageDto,
  PursuitNameDto,
  ReorderPursuitPipelinesDto,
  ReorderPursuitStagesDto,
} from "./pursuit-stages.dto";

@Controller("pursuit-pipelines")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class PursuitPipelinesController {
  constructor(private stages: PursuitStagesService) {}

  /** Every pipeline with its stages, in order. */
  @Get()
  findAll(@CurrentOrg("id") orgId: string): Promise<PipelineWithStages[]> {
    return this.stages.findAll(orgId);
  }

  @Post()
  create(@Body() dto: PursuitNameDto, @CurrentOrg("id") orgId: string): Promise<PipelineWithStages> {
    return this.stages.createPipeline(dto, orgId);
  }

  @Put("order")
  reorder(@Body() dto: ReorderPursuitPipelinesDto, @CurrentOrg("id") orgId: string): Promise<PipelineWithStages[]> {
    return this.stages.reorderPipelines(dto, orgId);
  }

  @Patch(":id")
  rename(@Param("id") id: string, @Body() dto: PursuitNameDto, @CurrentOrg("id") orgId: string): Promise<PursuitPipeline> {
    return this.stages.renamePipeline(id, dto, orgId);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @Query("moveTo") moveTo: string = "", @CurrentOrg("id") orgId: string): Promise<void> {
    return this.stages.removePipeline(id, moveTo, orgId);
  }
}

@Controller("pursuit-stages")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class PursuitStagesController {
  constructor(private stages: PursuitStagesService) {}

  @Post()
  create(@Body() dto: CreatePursuitStageDto, @CurrentOrg("id") orgId: string): Promise<PursuitStage> {
    return this.stages.createStage(dto, orgId);
  }

  @Put("order")
  reorder(@Body() dto: ReorderPursuitStagesDto, @CurrentOrg("id") orgId: string): Promise<PursuitStage[]> {
    return this.stages.reorderStages(dto, orgId);
  }

  @Patch(":id")
  rename(@Param("id") id: string, @Body() dto: PursuitNameDto, @CurrentOrg("id") orgId: string): Promise<PursuitStage> {
    return this.stages.renameStage(id, dto, orgId);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @Query("moveTo") moveTo: string = "", @CurrentOrg("id") orgId: string): Promise<void> {
    return this.stages.removeStage(id, moveTo, orgId);
  }
}
