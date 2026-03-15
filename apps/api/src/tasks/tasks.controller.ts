import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { CreateTaskDto, UpdateTaskDto, ReorderTasksDto, CastVoteDto } from "./tasks.dto";
import {
  AuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  CurrentOrg,
  PaginationQueryDto,
} from "../common";

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
