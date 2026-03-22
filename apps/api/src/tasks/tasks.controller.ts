import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { TasksService } from "./tasks.service";
import { CreateTaskDto, UpdateTaskDto, ReorderTasksDto, CastVoteDto } from "./tasks.dto";
import {
  AuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  CurrentOrg,
  PaginationQueryDto,
  contentDisposition,
  toCsv,
} from "../common";
import type { CsvColumn } from "../common";

@Controller("tasks")
@UseGuards(AuthGuard, RolesGuard)
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Post()
  @Roles("owner", "admin")
  create(
    @Body() dto: CreateTaskDto,
    @Query("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
  ) {
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.tasksService.create(dto, projectId, orgId);
  }

  @Get("project/:projectId")
  @Roles("owner", "admin")
  findByProject(
    @Param("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.tasksService.findByProject(
      projectId,
      orgId,
      pagination.page,
      pagination.limit,
    );
  }

  @Get("mine/:projectId")
  findByProjectForClient(
    @Param("projectId") projectId: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.tasksService.findByProjectForClient(
      projectId,
      userId,
      orgId,
      pagination.page,
      pagination.limit,
    );
  }

  @Get("project/:projectId/export")
  @Roles("owner", "admin")
  async exportCsv(
    @Param("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
    @Res() res: Response,
  ) {
    const data = await this.tasksService.exportByProject(projectId, orgId);
    const columns: CsvColumn<(typeof data)[0]>[] = [
      { header: "Title", value: (r) => r.title },
      { header: "Type", value: (r) => r.type },
      { header: "Status", value: (r) => r.completed ? "Completed" : "Pending" },
      { header: "Due Date", value: (r) => r.dueDate?.toISOString().split("T")[0] },
      { header: "Description", value: (r) => r.description },
      { header: "Created At", value: (r) => r.createdAt.toISOString().split("T")[0] },
    ];
    const csv = toCsv(columns, data);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", contentDisposition("tasks.csv"));
    res.send(csv);
  }

  // No @Roles — authorization is handled in the service via projectClient check
  @Post(":id/vote")
  vote(
    @Param("id") id: string,
    @Body() dto: CastVoteDto,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.tasksService.vote(id, dto.optionId, userId, orgId);
  }

  @Post(":id/close")
  @Roles("owner", "admin")
  closeVoting(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.tasksService.closeVoting(id, orgId);
  }

  @Put("reorder")
  @Roles("owner", "admin")
  reorder(
    @Body() dto: ReorderTasksDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.tasksService.reorder(dto.taskIds, orgId);
  }

  @Put(":id")
  @Roles("owner", "admin")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.tasksService.update(id, dto, orgId);
  }

  @Delete(":id")
  @Roles("owner", "admin")
  remove(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.tasksService.remove(id, orgId);
  }
}
