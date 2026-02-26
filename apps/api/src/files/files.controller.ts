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
import { AuthGuard, RolesGuard, Roles, CurrentUser, CurrentOrg, PaginationQueryDto } from "../common";

@Controller("files")
@UseGuards(AuthGuard, RolesGuard)
export class FilesController {
  constructor(private filesService: FilesService) {}

  @Post("upload")
  @Roles("owner", "admin")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 500 * 1024 * 1024 } }))
  upload(
    @UploadedFile() file: UploadedFileType,
    @Query("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    if (!file) throw new BadRequestException("No file provided");
    return this.filesService.upload(file, projectId, orgId, userId);
  }

  @Get("project/:projectId")
  findByProject(
    @Param("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.filesService.findByProject(
      projectId,
      orgId,
      pagination.page,
      pagination.limit,
    );
  }

  @Get(":id/download")
  async download(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
    @Res() res: Response,
  ) {
    const { body, contentType, filename } = await this.filesService.download(
      id,
      orgId,
    );
    // Sanitize filename for Content-Disposition: strip control chars and quotes
    const safeAscii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    // RFC 5987 encoded filename for non-ASCII support
    const encodedFilename = encodeURIComponent(filename).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodedFilename}`,
    );
    body.pipe(res);
  }

  @Get(":id/url")
  getDownloadUrl(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.filesService.getDownloadUrl(id, orgId);
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
