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
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Request, Response } from "express";
import { DocumentsService } from "./documents.service";
import { DocumentAuditService } from "./document-audit.service";
import { FilesService, UploadedFile as UploadedFileType, DOCUMENT_ALLOWED_MIMES } from "../files/files.service";
import {
  CreateDocumentDto,
  SendDocumentDto,
  RespondDocumentDto,
  SetSignatureFieldsDto,
  SignDocumentDto,
  VoidDocumentDto,
} from "./documents.dto";
import { Throttle } from "@nestjs/throttler";
import {
  AuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  CurrentOrg,
  CurrentMember,
  PaginationQueryDto,
  PlanLimit,
  contentDisposition,
  Public,
} from "../common";

@Controller("documents")
@UseGuards(AuthGuard, RolesGuard)
export class DocumentsController {
  constructor(
    private documentsService: DocumentsService,
    private filesService: FilesService,
    private auditService: DocumentAuditService,
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
    if (dto.requiresSignature && file.mimetype !== "application/pdf") {
      throw new BadRequestException("Signature collection is only supported for PDF files");
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

  @Post(":id/send")
  @Roles("owner", "admin")
  send(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @Body() dto: SendDocumentDto,
  ) {
    return this.documentsService.send(id, orgId, userId, dto.expiresInDays);
  }

  @Post(":id/void")
  @Roles("owner", "admin")
  voidDocument(
    @Param("id") id: string,
    @Body() dto: VoidDocumentDto,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.documentsService.voidDocument(id, orgId, userId, dto.reason);
  }

  @Post(":id/track-view")
  trackView(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @Req() req: Request,
  ) {
    return this.documentsService.trackView(
      id,
      userId,
      orgId,
      req.ip,
      req.headers["user-agent"],
    );
  }

  @Get(":id/audit-trail")
  @Roles("owner", "admin")
  async getAuditTrail(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    // Lightweight org ownership check
    await this.documentsService.assertDocumentAccess(id, orgId);
    return this.auditService.getAuditTrail(id, pagination.page, pagination.limit);
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

  @Get(":id/view")
  async viewDocument(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentMember("role") role: string,
    @Res() res: Response,
  ) {
    const { body, contentType, filename } = await this.documentsService.getViewStream(id, userId, orgId, role);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", contentDisposition(filename, "inline"));
    body.pipe(res);
  }

  @Get(":id/signing-info")
  getSigningInfo(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentMember("role") role: string,
  ) {
    return this.documentsService.getSigningInfo(id, userId, orgId, role);
  }

  @Get(":id/certificate")
  async getCertificate(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.documentsService.generateCertificate(id, orgId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", contentDisposition(filename, "attachment"));
    res.end(buffer);
  }

  @Get(":id")
  @Roles("owner", "admin")
  findOne(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.documentsService.findOne(id, orgId);
  }

  @Put(":id/signature-fields")
  @Roles("owner", "admin")
  setSignatureFields(
    @Param("id") id: string,
    @Body() dto: SetSignatureFieldsDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.documentsService.setSignatureFields(id, orgId, dto.fields);
  }

  @Post(":id/sign")
  @UseInterceptors(FileInterceptor("signature", { limits: { fileSize: 5 * 1024 * 1024 } }))
  async signDocument(
    @Param("id") id: string,
    @UploadedFile() file: UploadedFileType | undefined,
    @Body() dto: SignDocumentDto,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentMember("role") role: string,
    @Req() req: Request,
  ) {
    return this.documentsService.sign(
      id,
      userId,
      orgId,
      role,
      { method: dto.method, fieldId: dto.fieldId, timezone: dto.timezone, textValue: dto.textValue },
      file || null,
      req.ip,
      req.headers["user-agent"],
    );
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
      String(req.headers["user-agent"] || ""),
      dto.reason,
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

  // --- Public: Direct Signing Link ---
  @Get("sign-via-token/:token")
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async signViaToken(
    @Param("token") token: string,
  ) {
    const { document, userId } = await this.documentsService.validateAccessToken(token);
    // Only expose fields needed by the signing UI — no internal IDs
    return {
      documentId: document.id,
      userId,
      document: {
        id: document.id,
        title: document.title,
        type: document.type,
        status: document.status,
        requiresSignature: document.requiresSignature,
        requiresApproval: document.requiresApproval,
        signatureFields: document.signatureFields?.map((f) => ({ id: f.id })),
      },
    };
  }

  @Post("sign-via-token/:token/sign")
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseInterceptors(FileInterceptor("signature", { limits: { fileSize: 5 * 1024 * 1024 } }))
  async signViaTokenSubmit(
    @Param("token") token: string,
    @UploadedFile() file: UploadedFileType | undefined,
    @Body() dto: SignDocumentDto,
    @Req() req: Request,
  ) {
    const { userId, document } = await this.documentsService.validateAccessToken(token);
    return this.documentsService.sign(
      document.id,
      userId,
      document.organizationId,
      "member", // token-based signers are treated as members
      { method: dto.method, fieldId: dto.fieldId, timezone: dto.timezone, textValue: dto.textValue },
      file || null,
      req.ip,
      req.headers["user-agent"],
    );
  }

  @Get("sign-via-token/:token/signing-info")
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async signingInfoViaToken(
    @Param("token") token: string,
  ) {
    const { userId, document } = await this.documentsService.validateAccessToken(token);
    // Track view for token-based access
    this.documentsService.trackView(document.id, userId, document.organizationId).catch(() => {});
    return this.documentsService.getSigningInfo(document.id, userId, document.organizationId, "member");
  }

  @Get("sign-via-token/:token/view")
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async viewViaToken(
    @Param("token") token: string,
    @Res() res: Response,
  ) {
    const { userId, document } = await this.documentsService.validateAccessToken(token);
    const { body, contentType, filename } = await this.documentsService.getViewStream(document.id, userId, document.organizationId, "member");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", contentDisposition(filename, "inline"));
    body.pipe(res);
  }

  @Delete(":id/access-tokens/:tokenId")
  @Roles("owner", "admin")
  revokeAccessToken(
    @Param("id") id: string,
    @Param("tokenId") tokenId: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.documentsService.revokeAccessToken(id, tokenId, orgId);
  }

  @Post(":id/generate-access-token")
  @Roles("owner", "admin")
  generateAccessToken(
    @Param("id") id: string,
    @Body() body: { userId: string },
    @CurrentOrg("id") orgId: string,
  ) {
    return this.documentsService.generateAccessToken(id, body.userId, orgId);
  }
}
