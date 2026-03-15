import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Request } from "express";
import { DocumentsService } from "./documents.service";
import { FilesService, UploadedFile as UploadedFileType, DOCUMENT_ALLOWED_MIMES } from "../files/files.service";
import { CreateDocumentDto, RespondDocumentDto } from "./documents.dto";
import {
  AuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  CurrentOrg,
  PaginationQueryDto,
  PlanLimit,
} from "../common";

@Controller("documents")
@UseGuards(AuthGuard, RolesGuard)
export class DocumentsController {
  constructor(
    private documentsService: DocumentsService,
    private filesService: FilesService,
  ) {}

  @Post()
  @Roles("owner", "admin")
  @PlanLimit("storage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 200 * 1024 * 1024 } }))
  async create(
    @UploadedFile() file: UploadedFileType,
    @Body() dto: CreateDocumentDto,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    if (!file) throw new BadRequestException("No file provided");
    if (!DOCUMENT_ALLOWED_MIMES.has(file.mimetype)) {
      throw new BadRequestException(
        "Only PDF, Word, OpenDocument, and image files are allowed for documents",
      );
    }

    // Upload the file first using the files service
    const fileRecord = await this.filesService.upload(
      file,
      dto.projectId,
      orgId,
      userId,
    );

    return this.documentsService.create(dto, fileRecord.id, orgId, userId);
  }

  @Get("project/:projectId")
  @Roles("owner", "admin")
  findByProject(
    @Param("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.documentsService.findByProject(
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
    return this.documentsService.findByProjectForClient(
      projectId,
      userId,
      orgId,
      pagination.page,
      pagination.limit,
    );
  }

  @Get(":id")
  @Roles("owner", "admin")
  findOne(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.documentsService.findOne(id, orgId);
  }

  @Post(":id/respond")
  respond(
    @Param("id") id: string,
    @Body() dto: RespondDocumentDto,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @Req() req: Request,
  ) {
    return this.documentsService.respond(
      id,
      userId,
      orgId,
      dto.action,
      req.ip,
      req.headers["user-agent"],
    );
  }

  @Delete(":id")
  @Roles("owner", "admin")
  remove(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.documentsService.remove(id, orgId);
  }
}
