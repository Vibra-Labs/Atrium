import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { ProjectsService } from "./projects.service";
import { PursuitStagesService } from "./pursuit-stages.service";
import { PursuitService } from "./pursuit.service";
import { InternalItemsService, INTERNAL_KINDS } from "./internal-items.service";
import type { InternalItems, InternalKind } from "./internal-items.service";
import type { PipelineRow, WinResult } from "./pursuit.service";
import { LosePursuitDto, UpdatePursuitDto, WinPursuitDto } from "./pursuit.dto";
import { CostsService } from "./costs.service";
import type { ContractCosts } from "./costs.service";
import { CostLineDto, UpdateCostLineDto, UpdateCostsDto } from "./costs.dto";
import { pipelineFor, stageLabel } from "@atrium/shared";
import {
  CreateProjectDto,
  UpdateProjectDto,
  DuplicateProjectDto,
  ProjectListQueryDto,
  ClientProjectListQueryDto,
} from "./projects.dto";
import {
  AuthGuard,
  RolesGuard,
  Roles,
  PlanLimit,
  CurrentOrg,
  CurrentUser,
  CurrentMember,
  isPrivilegedRole,
  contentDisposition,
  toCsv,
} from "../common";
import type { CsvColumn } from "../common";

@Controller("projects")
@UseGuards(AuthGuard, RolesGuard)
export class ProjectsController {
  constructor(
    private projectsService: ProjectsService,
    private pursuitService: PursuitService,
    private internalItems: InternalItemsService,
    private costs: CostsService,
    private stages: PursuitStagesService,
  ) {}

  @Get()
  @Roles("owner", "admin")
  findAll(
    @Query() query: ProjectListQueryDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.projectsService.findAll(orgId, query);
  }

  @Get("mine")
  findMine(
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @Query() query: ClientProjectListQueryDto,
    @CurrentMember("role") role?: string,
  ) {
    const isPrivileged = isPrivilegedRole(role);
    return this.projectsService.findByClient(userId, orgId, query, isPrivileged);
  }

  @Get("mine/:id")
  findOneMine(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentMember("role") role?: string,
  ) {
    const isPrivileged = isPrivilegedRole(role);
    return this.projectsService.findOneByClient(id, userId, orgId, isPrivileged);
  }

  @Get("stats")
  @Roles("owner", "admin")
  getStats(@CurrentOrg("id") orgId: string) {
    return this.projectsService.getStats(orgId);
  }

  @Get("pipeline")
  @Roles("owner", "admin")
  getPipeline(@CurrentOrg("id") orgId: string): Promise<PipelineRow[]> {
    return this.pursuitService.pipeline(orgId);
  }

  @Get("statuses")
  getStatuses(@CurrentOrg("id") orgId: string) {
    return this.projectsService.getStatuses(orgId);
  }

  @Get("export")
  @Roles("owner", "admin")
  async exportCsv(@CurrentOrg("id") orgId: string, @Res() res: Response) {
    const [data, pipelines] = await Promise.all([this.projectsService.exportAll(orgId), this.stages.findAll(orgId)]);
    const columns: CsvColumn<(typeof data)[0]>[] = [
      { header: "Name", value: (r) => r.name },
      { header: "Status", value: (r) => r.status },
      { header: "Description", value: (r) => r.description },
      { header: "Start Date", value: (r) => r.startDate?.toISOString().split("T")[0] },
      { header: "End Date", value: (r) => r.endDate?.toISOString().split("T")[0] },
      { header: "Clients", value: (r) => r.clients.length },
      { header: "Archived", value: (r) => r.archivedAt ? "Yes" : "No" },
      {
        header: "Pipeline",
        value: (r) => (r.pursuit ? (pipelineFor(pipelines, r.pursuit.pipelineId)?.name ?? "") : ""),
      },
      { header: "Stage", value: (r) => (r.pursuit ? stageLabel(pipelines, r.pursuit.pipelineId, r.pursuit.stage) : "") },
      { header: "Outcome", value: (r) => r.pursuit?.outcome ?? "" },
      { header: "Value", value: (r) => (r.pursuit?.valueCents != null ? (r.pursuit.valueCents / 100).toFixed(2) : "") },
      { header: "Close Date", value: (r) => r.pursuit?.closeDate?.toISOString().split("T")[0] ?? "" },
      { header: "Created At", value: (r) => r.createdAt.toISOString().split("T")[0] },
    ];
    const csv = toCsv(columns, data);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", contentDisposition("projects.csv"));
    res.send(csv);
  }

  @Get(":id")
  @Roles("owner", "admin")
  findOne(@Param("id") id: string, @CurrentOrg("id") orgId: string) {
    return this.projectsService.findOne(id, orgId);
  }

  @Post()
  @Roles("owner", "admin")
  @PlanLimit("projects")
  create(@Body() dto: CreateProjectDto, @CurrentOrg("id") orgId: string) {
    return this.projectsService.create(dto, orgId);
  }

  @Patch(":id/pursuit")
  @Roles("owner", "admin")
  updatePursuit(@Param("id") id: string, @Body() dto: UpdatePursuitDto, @CurrentOrg("id") orgId: string) {
    return this.pursuitService.update(id, dto, orgId);
  }

  @Post(":id/pursuit/win")
  @Roles("owner", "admin")
  winPursuit(@Param("id") id: string, @Body() dto: WinPursuitDto, @CurrentOrg("id") orgId: string): Promise<WinResult> {
    return this.pursuitService.win(id, dto, orgId);
  }

  @Post(":id/pursuit/lose")
  @Roles("owner", "admin")
  losePursuit(@Param("id") id: string, @Body() dto: LosePursuitDto, @CurrentOrg("id") orgId: string): Promise<void> {
    return this.pursuitService.lose(id, dto, orgId);
  }

  @Post(":id/pursuit/reopen")
  @Roles("owner", "admin")
  reopenPursuit(@Param("id") id: string, @CurrentOrg("id") orgId: string): Promise<void> {
    return this.pursuitService.reopen(id, orgId);
  }

  @Get(":id/costs")
  @Roles("owner", "admin")
  getCosts(@Param("id") id: string, @CurrentOrg("id") orgId: string): Promise<ContractCosts> {
    return this.costs.get(id, orgId);
  }

  @Patch(":id/costs")
  @Roles("owner", "admin")
  updateCosts(@Param("id") id: string, @Body() dto: UpdateCostsDto, @CurrentOrg("id") orgId: string): Promise<ContractCosts> {
    return this.costs.update(id, dto, orgId);
  }

  @Post(":id/costs/lines")
  @Roles("owner", "admin")
  addCostLine(@Param("id") id: string, @Body() dto: CostLineDto, @CurrentOrg("id") orgId: string): Promise<ContractCosts> {
    return this.costs.addLine(id, dto, orgId);
  }

  @Patch(":id/costs/lines/:lineId")
  @Roles("owner", "admin")
  updateCostLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body() dto: UpdateCostLineDto,
    @CurrentOrg("id") orgId: string,
  ): Promise<ContractCosts> {
    return this.costs.updateLine(id, lineId, dto, orgId);
  }

  @Delete(":id/costs/lines/:lineId")
  @Roles("owner", "admin")
  removeCostLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @CurrentOrg("id") orgId: string,
  ): Promise<ContractCosts> {
    return this.costs.removeLine(id, lineId, orgId);
  }

  @Get(":id/internal")
  @Roles("owner", "admin")
  listInternal(@Param("id") id: string, @CurrentOrg("id") orgId: string): Promise<InternalItems> {
    return this.internalItems.list(id, orgId);
  }

  @Post(":id/internal/:kind/:itemId/share")
  @Roles("owner", "admin")
  shareInternal(
    @Param("id") id: string,
    @Param("kind") kind: string,
    @Param("itemId") itemId: string,
    @CurrentOrg("id") orgId: string,
  ): Promise<void> {
    if (!(INTERNAL_KINDS as readonly string[]).includes(kind)) throw new BadRequestException("Unknown item kind");
    return this.internalItems.share(id, kind as InternalKind, itemId, orgId);
  }

  @Post(":id/archive")
  @Roles("owner", "admin")
  archive(@Param("id") id: string, @CurrentOrg("id") orgId: string) {
    return this.projectsService.archive(id, orgId);
  }

  @Post(":id/duplicate")
  @Roles("owner", "admin")
  @PlanLimit("projects")
  duplicate(
    @Param("id") id: string,
    @Body() dto: DuplicateProjectDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.projectsService.duplicate(id, dto, orgId);
  }

  @Post(":id/unarchive")
  @Roles("owner", "admin")
  unarchive(@Param("id") id: string, @CurrentOrg("id") orgId: string) {
    return this.projectsService.unarchive(id, orgId);
  }

  @Put(":id")
  @Roles("owner", "admin")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.projectsService.update(id, dto, orgId);
  }

  @Delete(":id")
  @Roles("owner")
  remove(@Param("id") id: string, @CurrentOrg("id") orgId: string) {
    return this.projectsService.remove(id, orgId);
  }
}
