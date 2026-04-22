import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { ProjectsService } from "./projects.service";
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
  contentDisposition,
  toCsv,
} from "../common";
import type { CsvColumn } from "../common";

@Controller("projects")
@UseGuards(AuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

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
  ) {
    return this.projectsService.findByClient(userId, orgId, query);
  }

  @Get("mine/:id")
  findOneMine(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.projectsService.findOneByClient(id, userId, orgId);
  }

  @Get("stats")
  @Roles("owner", "admin")
  getStats(@CurrentOrg("id") orgId: string) {
    return this.projectsService.getStats(orgId);
  }

  @Get("statuses")
  getStatuses(@CurrentOrg("id") orgId: string) {
    return this.projectsService.getStatuses(orgId);
  }

  @Get("export")
  @Roles("owner", "admin")
  async exportCsv(@CurrentOrg("id") orgId: string, @Res() res: Response) {
    const data = await this.projectsService.exportAll(orgId);
    const columns: CsvColumn<(typeof data)[0]>[] = [
      { header: "Name", value: (r) => r.name },
      { header: "Status", value: (r) => r.status },
      { header: "Description", value: (r) => r.description },
      { header: "Start Date", value: (r) => r.startDate?.toISOString().split("T")[0] },
      { header: "End Date", value: (r) => r.endDate?.toISOString().split("T")[0] },
      { header: "Clients", value: (r) => r.clients.length },
      { header: "Archived", value: (r) => r.archivedAt ? "Yes" : "No" },
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
