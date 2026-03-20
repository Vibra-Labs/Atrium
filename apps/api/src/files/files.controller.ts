import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { FilesService, UploadedFile as UploadedFileType } from "./files.service";
import { AuthGuard, RolesGuard, Roles, PlanLimit, CurrentUser, CurrentOrg, CurrentMember, PaginationQueryDto, contentDisposition } from "../common";

@Controller("files")
@UseGuards(AuthGuard, RolesGuard)
export class FilesController {
  constructor(private filesService: FilesService) {}

  @Post("upload")
  @Roles("owner", "admin")
  @PlanLimit("storage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 200 * 1024 * 1024 } }))
  upload(
    @UploadedFile() file: UploadedFileType,
    @Query("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    if (!file) throw new BadRequestException("No file provided");
    return this.filesService.upload(file, projectId, orgId, userId);
  }

  @Post("upload/mine")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 200 * 1024 * 1024 } }))
  uploadMine(
    @UploadedFile() file: UploadedFileType,
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

  @Delete(":id")
  @Roles("owner", "admin")
  remove(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.filesService.remove(id, orgId);
  }
}
