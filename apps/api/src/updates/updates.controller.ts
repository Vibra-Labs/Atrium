import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { UpdatesService } from "./updates.service";
import { CreateUpdateDto } from "./updates.dto";
import { AuthGuard, RolesGuard, Roles, CurrentUser, CurrentOrg, CurrentMember, PaginationQueryDto } from "../common";
import type { UploadedFile as UploadedFileType } from "../files/files.service";

@Controller("updates")
@UseGuards(AuthGuard, RolesGuard)
export class UpdatesController {
  constructor(private updatesService: UpdatesService) {}

  @Post()
  @Roles("owner", "admin")
  @UseInterceptors(
    FileInterceptor("attachment", { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  create(
    @Body() dto: CreateUpdateDto,
    @Query("projectId") projectId: string,
    @UploadedFile() attachment: UploadedFileType | undefined,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.updatesService.create(dto, projectId, orgId, userId, attachment);
  }

  @Get("project/:projectId")
  @Roles("owner", "admin")
  findByProject(
    @Param("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.updatesService.findByProject(
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
    return this.updatesService.findByProjectForClient(
      projectId,
      userId,
      orgId,
      pagination.page,
      pagination.limit,
    );
  }

  @Get(":id/attachment")
  getAttachment(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
    @Res() res: Response,
  ) {
    return this.updatesService.getAttachment(id, orgId, userId, role, res);
  }

  @Delete(":id")
  @Roles("owner", "admin")
  remove(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.updatesService.remove(id, orgId);
  }
}
