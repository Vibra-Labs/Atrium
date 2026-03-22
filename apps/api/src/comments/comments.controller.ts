import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CommentsService } from "./comments.service";
import { CreateCommentDto } from "./comments.dto";
import {
  AuthGuard,
  RolesGuard,
  CurrentUser,
  CurrentOrg,
  CurrentMember,
  PaginationQueryDto,
} from "../common";

@Controller("comments")
@UseGuards(AuthGuard, RolesGuard)
export class CommentsController {
  constructor(private commentsService: CommentsService) {}

  @Post("update/:updateId")
  createOnUpdate(
    @Param("updateId") updateId: string,
    @Body() dto: CreateCommentDto,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
  ) {
    return this.commentsService.create("update", updateId, dto.content, orgId, userId, role);
  }

  @Post("task/:taskId")
  createOnTask(
    @Param("taskId") taskId: string,
    @Body() dto: CreateCommentDto,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
  ) {
    return this.commentsService.create("task", taskId, dto.content, orgId, userId, role);
  }

  @Get("update/:updateId")
  findByUpdate(
    @Param("updateId") updateId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.commentsService.findByTarget(
      "update", updateId, orgId, userId, role,
      pagination.page, pagination.limit,
    );
  }

  @Get("task/:taskId")
  findByTask(
    @Param("taskId") taskId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.commentsService.findByTarget(
      "task", taskId, orgId, userId, role,
      pagination.page, pagination.limit,
    );
  }

  @Delete(":id")
  remove(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
  ) {
    return this.commentsService.remove(id, orgId, userId, role);
  }
}
