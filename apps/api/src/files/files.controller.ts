import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from "@nestjs/common";
import type { Response } from "express";
import type { File } from "@atrium/database";
import { FilesService, MAX_UPLOAD_BYTES, type TempUploadedFile } from "./files.service";
import { TempFileInterceptor } from "./temp-file.interceptor";
import { CreateFileLinkDto, UpdateFileDto } from "./files.dto";
import { DOWNLOAD_CACHE } from "../common/helpers/http-cache";
import { AuthGuard, RolesGuard, Roles, PlanLimit, CurrentUser, CurrentOrg, CurrentMember, PaginationQueryDto, contentDisposition } from "../common";

@Controller("files")
@UseGuards(AuthGuard, RolesGuard)
export class FilesController {
  constructor(private filesService: FilesService) {}

  @Post("upload")
  @Roles("owner", "admin")
  @PlanLimit("storage")
  @UseInterceptors(TempFileInterceptor("file", MAX_UPLOAD_BYTES))
  upload(
    @UploadedFile() file: TempUploadedFile,
    @Query("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    if (!file) throw new BadRequestException("No file provided");
    return this.filesService.upload(file, projectId, orgId, userId);
  }

  @Post("link")
  @Roles("owner", "admin")
  createLink(
    @Body() dto: CreateFileLinkDto,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.filesService.createLink(dto.projectId, orgId, userId, {
      url: dto.url,
      title: dto.title,
      description: dto.description,
    });
  }

  @Post("upload/mine")
  @UseInterceptors(TempFileInterceptor("file", MAX_UPLOAD_BYTES))
  uploadMine(
    @UploadedFile() file: TempUploadedFile,
    @Query("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    if (!file) throw new BadRequestException("No file provided");
    return this.filesService.uploadAsClient(file, projectId, orgId, userId);
  }

  @Get("project/:projectId")
  findByProject(
    @Param("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.filesService.findByProject(
      projectId,
      orgId,
      userId,
      role,
      pagination.page,
      pagination.limit,
    );
  }

  @Get(":id/download")
  async download(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
    @Res() res: Response,
  ) {
    const { body, contentType, filename } = await this.filesService.download(
      id,
      orgId,
      userId,
      role,
    );
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", contentDisposition(filename));
    res.setHeader("Cache-Control", DOWNLOAD_CACHE);
    body.pipe(res);
  }

  @Get(":id/url")
  getDownloadUrl(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
  ) {
    return this.filesService.getDownloadUrl(id, orgId, userId, role);
  }

  @Patch(":id")
  @Roles("owner", "admin")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateFileDto,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
  ): Promise<File> {
    return this.filesService.update(id, dto, orgId, userId, role);
  }

  @Delete(":id")
  @Roles("owner", "admin")
  remove(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.filesService.remove(id, orgId);
  }
}
