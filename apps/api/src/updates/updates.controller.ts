import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type { ProjectUpdate } from "@atrium/database";
import { UpdatesService } from "./updates.service";
import { WeeklyUpdatesService } from "./weekly-updates.service";
import type { WeeklyDraft, WeeklyUpdateDue } from "./weekly-updates.service";
import { CreateUpdateDto, UpdateContentDto, UpdatePreviewPrefsDto } from "./updates.dto";
import { AuthGuard, RolesGuard, Roles, CurrentUser, CurrentOrg, CurrentMember, PaginationQueryDto } from "../common";
import type { UploadedFile as UploadedFileType } from "../files/files.service";

@Controller("updates")
@UseGuards(AuthGuard, RolesGuard)
export class UpdatesController {
  constructor(
    private updatesService: UpdatesService,
    private weeklyUpdates: WeeklyUpdatesService,
  ) {}

  // Owner/admin only: the draft is reviewed in the composer, never posted automatically.
  @Get("weekly-due")
  @Roles("owner", "admin")
  findWeeklyDue(@CurrentOrg("id") orgId: string): Promise<WeeklyUpdateDue[]> {
    return this.weeklyUpdates.getDue(orgId);
  }

  @Get("weekly-draft/:projectId")
  @Roles("owner", "admin")
  getWeeklyDraft(
    @Param("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
  ): Promise<WeeklyDraft> {
    return this.weeklyUpdates.getDraft(projectId, orgId);
  }

  // No @Roles — any authenticated org member (including clients) can post updates.
  // Access is enforced via assertProjectAccess in the service (clients must be assigned to the project).
  @Post()
  @UseInterceptors(
    FileInterceptor("attachment", { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  create(
    @Body() dto: CreateUpdateDto,
    @Query("projectId") projectId: string,
    @UploadedFile() attachment: UploadedFileType | undefined,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
  ): Promise<ProjectUpdate> {
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.updatesService.create(dto, projectId, orgId, userId, role, attachment);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateContentDto,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
  ): Promise<ProjectUpdate> {
    return this.updatesService.update(id, dto, orgId, userId, role);
  }

  @Patch(":id/preview-prefs")
  updatePreviewPrefs(
    @Param("id") id: string,
    @Body() dto: UpdatePreviewPrefsDto,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
  ): Promise<ProjectUpdate> {
    return this.updatesService.updatePreviewPrefs(
      id,
      orgId,
      userId,
      role,
      dto.previewPrefs,
    );
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

  @Get("timeline/mine/:projectId")
  findTimelineForClient(
    @Param("projectId") projectId: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @Query() pagination: PaginationQueryDto,
    @CurrentMember("role") role?: string,
  ) {
    const isPrivileged = role === "owner" || role === "admin";
    return this.updatesService.findTimelineForClient(
      projectId,
      userId,
      orgId,
      pagination.page,
      pagination.limit,
      isPrivileged,
    );
  }

  @Get("timeline/:projectId")
  @Roles("owner", "admin")
  findTimeline(
    @Param("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.updatesService.findTimeline(
      projectId,
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
