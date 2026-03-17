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
    @Query("documentType") documentType: string | undefined,
    @Query("documentTitle") documentTitle: string | undefined,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    if (!file) throw new BadRequestException("No file provided");
    const documentMeta = documentType
      ? { documentType, documentTitle }
      : undefined;
    return this.filesService.upload(file, projectId, orgId, userId, documentMeta);
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

  @Patch(":id/respond")
  respond(
    @Param("id") id: string,
    @Body("action") action: string,
    @Body("reason") reason: string | undefined,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
  ) {
    // Normalize "declined" → "rejected" for consistency across both document systems
    const normalized = action === "declined" ? "rejected" : action;
    if (normalized !== "accepted" && normalized !== "rejected") {
      throw new BadRequestException("Action must be 'accepted', 'declined', or 'rejected'");
    }
    return this.filesService.respondToDocument(id, orgId, userId, role, normalized, reason);
  }

  @Patch(":id/viewed")
  markViewed(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
  ) {
    return this.filesService.markDocumentViewed(id, orgId, userId, role);
  }

  @Patch(":id/status")
  @Roles("owner", "admin")
  updateDocumentStatus(
    @Param("id") id: string,
    @Body("status") status: string,
    @CurrentOrg("id") orgId: string,
  ) {
    const allowed = ["pending", "accepted", "rejected"];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`Status must be one of: ${allowed.join(", ")}`);
    }
    return this.filesService.updateDocumentStatus(id, orgId, status);
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
