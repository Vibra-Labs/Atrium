import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { randomBytes, createHash } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  paginationArgs,
  paginatedResponse,
  assertProjectAccess,
  sanitizeFilename,
} from "../common";
import type { StorageProvider } from "../files/storage/storage.interface";
import { STORAGE_PROVIDER } from "../files/storage/storage.interface";
import { CreateDocumentDto } from "./documents.dto";
import { NotificationsService } from "../notifications/notifications.service";
import { ActivityService } from "../activity/activity.service";
import { DocumentAuditService } from "./document-audit.service";

/** Max PDF size allowed for signing (50MB) to prevent OOM. */
const MAX_SIGNABLE_PDF_BYTES = 50 * 1024 * 1024;
const ALLOWED_SIGNATURE_MIMES = new Set(["image/png", "image/jpeg"]);

const ALLOWED_ACTIONS: Record<string, string[]> = {
  quote: ["accepted", "declined"],
  contract: ["accepted", "declined"],
  proposal: ["accepted", "declined"],
  nda: ["accepted", "declined"],
  other: ["accepted", "declined"],
};

/** Statuses that block respond/sign actions. */
const RESPOND_BLOCKED_STATUSES = new Set(["draft", "voided", "expired", "accepted", "declined", "signed"]);
const SIGN_BLOCKED_STATUSES = new Set(["draft", "voided", "expired", "signed"]);

/** Shared include shape for document queries that need full details. */
const DOCUMENT_FULL_INCLUDE = {
  file: true,
  signedFile: true,
  signatureFields: true,
  responses: {
    include: { user: { select: { id: true, name: true } } },
  },
} as const;

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private storage: StorageProvider,
    @InjectPinoLogger(DocumentsService.name) private readonly logger: PinoLogger,
    private notifications: NotificationsService,
    private activityService: ActivityService,
    private auditService: DocumentAuditService,
  ) {}

  async create(
    dto: CreateDocumentDto,
    fileId: string,
    orgId: string,
    uploadedById: string,
  ) {
    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, organizationId: orgId },
    });
    if (!project) throw new NotFoundException("Project not found");

    const document = await this.prisma.document.create({
      data: {
        type: dto.type,
        title: dto.title,
        fileId,
        projectId: dto.projectId,
        organizationId: orgId,
        uploadedById,
        status: "draft",
        requiresSignature: dto.requiresSignature ?? false,
        requiresApproval: dto.requiresApproval ?? false,
        options: dto.options || null,
        signingOrderEnabled: dto.signingOrderEnabled ?? false,
        reminderEnabled: dto.reminderEnabled ?? false,
        reminderIntervalDays: dto.reminderIntervalDays ?? 3,
      },
      include: DOCUMENT_FULL_INCLUDE,
    });

    this.auditService.log(document.id, "created", { userId: uploadedById });

    return document;
  }

  async send(
    id: string,
    orgId: string,
    userId: string,
    expiresInDays?: number,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId: orgId },
      include: { signatureFields: true },
    });
    if (!doc) throw new NotFoundException("Document not found");
    if (doc.status !== "draft") {
      throw new BadRequestException("Only draft documents can be sent");
    }

    // Prevent sending signature docs with no fields placed
    if (doc.requiresSignature && doc.signatureFields.length === 0) {
      throw new BadRequestException(
        "Please place signature fields before sending this document",
      );
    }

    const sentAt = new Date();
    const expiresAt = expiresInDays
      ? new Date(sentAt.getTime() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const updated = await this.prisma.document.update({
      where: { id },
      data: {
        status: "pending",
        sentAt,
        ...(expiresAt ? { expiresAt } : {}),
      },
      include: DOCUMENT_FULL_INCLUDE,
    });

    this.auditService.log(id, "sent", { userId });
    this.notifications.notifyDocumentUploaded(id);

    return updated;
  }

  async voidDocument(
    id: string,
    orgId: string,
    userId: string,
    reason?: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!doc) throw new NotFoundException("Document not found");

    const voidableStatuses = new Set(["draft", "pending"]);
    if (!voidableStatuses.has(doc.status)) {
      throw new BadRequestException(
        `Cannot void a document with status "${doc.status}"`,
      );
    }

    const updated = await this.prisma.document.update({
      where: { id },
      data: {
        status: "voided",
        voidedAt: new Date(),
        voidedById: userId,
        voidReason: reason || null,
      },
      include: DOCUMENT_FULL_INCLUDE,
    });

    this.auditService.log(id, "voided", {
      userId,
      metadata: reason ? { reason } : undefined,
    });

    return updated;
  }

  async trackView(
    id: string,
    userId: string,
    orgId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!doc) throw new NotFoundException("Document not found");

    // Log view event (idempotent check — only log first view per user)
    const existingView = await this.prisma.documentAuditEvent.findFirst({
      where: { documentId: id, userId, action: "viewed" },
    });

    if (!existingView) {
      this.auditService.log(id, "viewed", { userId, ipAddress, userAgent });
    }

    return { viewed: true };
  }

  async findByProject(
    projectId: string,
    orgId: string,
    page = 1,
    limit = 20,
  ) {
    const where = { projectId, organizationId: orgId };
    const [data, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        include: DOCUMENT_FULL_INCLUDE,
        orderBy: { createdAt: "desc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.document.count({ where }),
    ]);
    return paginatedResponse(data, total, page, limit);
  }

  async findByProjectForClient(
    projectId: string,
    userId: string,
    orgId: string,
    page = 1,
    limit = 20,
  ) {
    const assignment = await this.prisma.projectClient.findFirst({
      where: { projectId, userId, project: { organizationId: orgId } },
    });
    if (!assignment) {
      throw new ForbiddenException("Not assigned to this project");
    }

    // Filter out drafts for clients
    const where = {
      projectId,
      organizationId: orgId,
      status: { not: "draft" },
    };
    const [data, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        include: {
          file: true,
          signedFile: true,
          signatureFields: true,
          responses: {
            where: { userId },
            select: {
              id: true,
              documentId: true,
              userId: true,
              action: true,
              reason: true,
              signatureMethod: true,
              signedAt: true,
              fieldId: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.document.count({ where }),
    ]);
    return paginatedResponse(data, total, page, limit);
  }

  async assertDocumentAccess(id: string, orgId: string) {
    const exists = await this.prisma.document.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException("Document not found");
  }

  async findOne(id: string, orgId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId: orgId },
      include: DOCUMENT_FULL_INCLUDE,
    });
    if (!doc) throw new NotFoundException("Document not found");
    return doc;
  }

  async respond(
    id: string,
    userId: string,
    orgId: string,
    action: string,
    ipAddress?: string,
    userAgent?: string,
    reason?: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!doc) throw new NotFoundException("Document not found");

    if (RESPOND_BLOCKED_STATUSES.has(doc.status)) {
      throw new BadRequestException(
        `Cannot respond to a document with status "${doc.status}"`,
      );
    }

    // Check expiry
    if (doc.expiresAt && new Date() > doc.expiresAt) {
      throw new BadRequestException("This document has expired");
    }

    // Verify client is assigned to the project
    const assignment = await this.prisma.projectClient.findFirst({
      where: { projectId: doc.projectId, userId },
    });
    if (!assignment) {
      throw new ForbiddenException("Not assigned to this project");
    }

    if (!doc.requiresApproval) {
      throw new BadRequestException("This document does not require approval");
    }

    // Validate action for document type
    const allowed = ALLOWED_ACTIONS[doc.type] || ["accepted", "declined"];
    if (!allowed.includes(action)) {
      throw new BadRequestException(
        `Action "${action}" is not allowed for document type "${doc.type}"`,
      );
    }

    // For non-signing responses, find existing response without a fieldId
    const existing = await this.prisma.documentResponse.findFirst({
      where: { documentId: id, userId, fieldId: null },
    });

    let response;
    if (existing) {
      response = await this.prisma.documentResponse.update({
        where: { id: existing.id },
        data: { action, reason: reason || null, ipAddress, userAgent },
      });
    } else {
      response = await this.prisma.documentResponse.create({
        data: {
          documentId: id,
          userId,
          action,
          reason: reason || null,
          ipAddress,
          userAgent,
        },
      });
    }

    // Update document status based on all responses
    await this.updateDocumentStatus(id);

    this.auditService.log(id, action, { userId, ipAddress, userAgent });
    this.notifications.notifyDocumentResponded(id, userId, action);

    this.activityService
      .create({
        type: "document_response",
        action,
        actorId: userId,
        targetId: id,
        targetTitle: doc.title,
        projectId: doc.projectId,
        organizationId: orgId,
      })
      .catch((err) => this.logger.warn({ err }, "Failed to log document response activity"));

    return response;
  }

  private async updateDocumentStatus(documentId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { responses: true, signatureFields: true },
    });
    if (!doc) return;

    if (doc.responses.length === 0) return;

    // If any client declined, status is declined
    if (doc.responses.some((r) => r.action === "declined")) {
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: "declined" },
      });
      return;
    }

    // Handle signature-based documents
    if (doc.requiresSignature && doc.signatureFields.length > 0) {
      const signedResponses = doc.responses.filter((r) => r.action === "signed");
      const signedFieldIds = new Set(signedResponses.map((r) => r.fieldId));
      const allFieldsSigned = doc.signatureFields.every((f) => signedFieldIds.has(f.id));
      if (allFieldsSigned) {
        await this.prisma.document.update({
          where: { id: documentId },
          data: { status: "signed" },
        });
        this.notifications.notifyDocumentResponded(documentId, "", "signed");
      }
      return;
    }

    // If all assigned clients have responded positively
    const clientCount = await this.prisma.projectClient.count({
      where: { projectId: doc.projectId },
    });
    if (doc.responses.length >= clientCount) {
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: "accepted" },
      });
      this.notifications.notifyDocumentResponded(documentId, "", "accepted");
      return;
    }
  }

  async getViewStream(id: string, userId: string, orgId: string, role: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId: orgId },
      include: { file: true, signedFile: true },
    });
    if (!doc) throw new NotFoundException("Document not found");

    await assertProjectAccess(this.prisma, doc.projectId, userId, role);

    const fileToView = doc.signedFile ?? doc.file;
    const { body, contentType } = await this.storage.download(fileToView.storageKey);

    this.auditService.log(id, "downloaded", { userId });

    return { body, contentType, filename: fileToView.filename };
  }

  async setSignatureFields(
    docId: string,
    orgId: string,
    fields: {
      pageNumber: number;
      x: number;
      y: number;
      width: number;
      height: number;
      type?: string;
      label?: string;
      required?: boolean;
      signerOrder?: number;
      assignedTo?: string;
    }[],
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, organizationId: orgId },
    });
    if (!doc) throw new NotFoundException("Document not found");
    if (doc.status !== "draft") {
      throw new BadRequestException("Signature fields can only be edited on draft documents");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.signatureField.deleteMany({ where: { documentId: docId } });
      if (fields.length > 0) {
        await tx.signatureField.createMany({
          data: fields.map((f) => ({
            documentId: docId,
            pageNumber: f.pageNumber,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            type: f.type || "signature",
            label: f.label || null,
            required: f.required ?? true,
            signerOrder: f.signerOrder ?? 0,
            assignedTo: f.assignedTo || null,
          })),
        });
      }
    });

    return this.prisma.document.findUnique({
      where: { id: docId },
      include: DOCUMENT_FULL_INCLUDE,
    });
  }

  async sign(
    id: string,
    userId: string,
    orgId: string,
    role: string,
    dto: { method: string; fieldId: string; timezone?: string; textValue?: string },
    signatureFile: { buffer: Buffer; originalname: string; mimetype: string; size: number } | null,
    ipAddress?: string,
    userAgent?: string,
  ) {
    // Use a single serialized transaction with FOR UPDATE to prevent concurrent
    // signers from overwriting each other's signatures in the PDF.
    const response = await this.prisma.$transaction(async (tx) => {
      // Lock the document row to serialize concurrent signing operations
      await tx.$queryRawUnsafe(
        `SELECT id FROM "document" WHERE id = $1 FOR UPDATE`,
        id,
      );

      const doc = await tx.document.findFirst({
        where: { id, organizationId: orgId },
        include: { signatureFields: true, file: true, signedFile: true },
      });
      if (!doc) throw new NotFoundException("Document not found");
      if (!doc.requiresSignature) {
        throw new BadRequestException("This document does not require a signature");
      }

      if (SIGN_BLOCKED_STATUSES.has(doc.status)) {
        throw new BadRequestException(
          doc.status === "signed"
            ? "This document has already been fully signed"
            : `Cannot sign a document with status "${doc.status}"`,
        );
      }

      // Check expiry
      if (doc.expiresAt && new Date() > doc.expiresAt) {
        throw new BadRequestException("This document has expired");
      }

      const field = doc.signatureFields.find((f) => f.id === dto.fieldId);
      if (!field) {
        throw new BadRequestException("Signature field not found on this document");
      }

      const isAdmin = role === "owner" || role === "admin";
      const [assignment, existingResponse, signer] = await Promise.all([
        isAdmin ? null : tx.projectClient.findFirst({ where: { projectId: doc.projectId, userId } }),
        tx.documentResponse.findFirst({ where: { documentId: id, userId, fieldId: dto.fieldId } }),
        tx.user.findUnique({ where: { id: userId }, select: { name: true } }),
      ]);
      if (!isAdmin && !assignment) throw new ForbiddenException("Not assigned to this project");
      if (existingResponse) throw new BadRequestException("You have already signed this field");

      // Check signing order if enabled
      if (doc.signingOrderEnabled && field.signerOrder > 0) {
        const priorFields = doc.signatureFields.filter(
          (f) => f.signerOrder > 0 && f.signerOrder < field.signerOrder,
        );
        if (priorFields.length > 0) {
          const priorFieldIds = priorFields.map((f) => f.id);
          const priorResponses = await tx.documentResponse.findMany({
            where: { documentId: id, fieldId: { in: priorFieldIds }, action: "signed" },
          });
          const signedPriorIds = new Set(priorResponses.map((r) => r.fieldId));
          const allPriorSigned = priorFieldIds.every((fid) => signedPriorIds.has(fid));
          if (!allPriorSigned) {
            throw new BadRequestException("Previous signers must complete their fields first");
          }
        }
      }

      // Check assigned-to constraint
      if (field.assignedTo && field.assignedTo !== userId) {
        throw new ForbiddenException("This field is assigned to another signer");
      }

      const signerName = signer?.name || "Unknown";
      const signedDate = new Date();

      // Handle different field types
      if (field.type === "date") {
        // Date field — auto-fill with current date, embed as text
        const dateOpts: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" };
        if (dto.timezone) {
          try { dateOpts.timeZone = dto.timezone; } catch { /* ignore invalid tz */ }
        }
        const formattedDate = signedDate.toLocaleDateString("en-US", dateOpts);

        return await this.embedTextInPdf(tx, doc, field, formattedDate, {
          id, userId, orgId, signerName, signedDate, ipAddress, userAgent,
          dto: { method: dto.method, fieldId: dto.fieldId },
          textValue: formattedDate,
        });
      }

      if (field.type === "text" || field.type === "select") {
        // Text/select field — accept textValue, embed as text
        if (!dto.textValue) {
          throw new BadRequestException(`A value is required for ${field.type} fields`);
        }
        return await this.embedTextInPdf(tx, doc, field, dto.textValue, {
          id, userId, orgId, signerName, signedDate, ipAddress, userAgent,
          dto: { method: dto.method, fieldId: dto.fieldId },
          textValue: dto.textValue,
        });
      }

      // Signature and initials fields — require image upload
      if (!signatureFile) {
        throw new BadRequestException("No signature file provided");
      }
      if (!ALLOWED_SIGNATURE_MIMES.has(signatureFile.mimetype)) {
        throw new BadRequestException("Signature must be a PNG or JPEG image");
      }

      // Upload signature image to storage
      const sigKey = `${orgId}/${doc.projectId}/signatures/${id}-${userId}-${dto.fieldId}.png`;
      await this.storage.upload(sigKey, signatureFile.buffer, signatureFile.mimetype);

      // Download the latest signed PDF (or original)
      const sourceFile = doc.signedFileId ? doc.signedFile! : doc.file;
      const { body: pdfStream } = await this.storage.download(sourceFile.storageKey);

      const pdfChunks: Buffer[] = [];
      let totalSize = 0;
      for await (const chunk of pdfStream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalSize += buf.length;
        if (totalSize > MAX_SIGNABLE_PDF_BYTES) {
          throw new BadRequestException(
            `PDF is too large for signing (max ${MAX_SIGNABLE_PDF_BYTES / 1024 / 1024}MB)`,
          );
        }
        pdfChunks.push(buf);
      }
      const pdfBuffer = Buffer.concat(pdfChunks);

      const pdfDoc = await PDFDocument.load(pdfBuffer);

      if (field.pageNumber >= pdfDoc.getPageCount()) {
        throw new BadRequestException(
          `Signature field references page ${field.pageNumber} but the PDF only has ${pdfDoc.getPageCount()} page(s)`,
        );
      }

      const embedImage = signatureFile.mimetype === "image/jpeg"
        ? await pdfDoc.embedJpg(signatureFile.buffer)
        : await pdfDoc.embedPng(signatureFile.buffer);
      const page = pdfDoc.getPages()[field.pageNumber];
      const { width: pageW, height: pageH } = page.getSize();

      const drawX = field.x * pageW;
      const drawY = pageH - (field.y * pageH) - (field.height * pageH);
      const drawW = field.width * pageW;
      const drawH = field.height * pageH;

      page.drawImage(embedImage, { x: drawX, y: drawY, width: drawW, height: drawH });

      const fontSize = Math.max(6, drawH * 0.15);
      const annotY = drawY - fontSize - 2 > 0
        ? drawY - fontSize - 2
        : drawY + drawH + 2;
      const dateOpts: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" };
      if (dto.timezone) {
        try { dateOpts.timeZone = dto.timezone; } catch { /* ignore invalid tz */ }
      }
      const formattedDate = signedDate.toLocaleDateString("en-US", dateOpts);
      const annotText = field.type === "initials"
        ? `Initialed by ${signerName} on ${formattedDate}`
        : `Signed by ${signerName} on ${formattedDate}`;
      page.drawText(annotText, {
        x: drawX,
        y: annotY,
        size: fontSize,
      });

      const pdfBytes = await pdfDoc.save();

      const signedPdfKey = `${orgId}/${doc.projectId}/documents/${id}-signed.pdf`;
      await this.storage.upload(signedPdfKey, Buffer.from(pdfBytes), "application/pdf");

      // Clean up old signed File record
      const oldSignedFileId = doc.signedFileId;

      const signedFileRecord = await tx.file.create({
        data: {
          filename: sanitizeFilename(`${doc.title}-signed.pdf`),
          storageKey: signedPdfKey,
          mimeType: "application/pdf",
          sizeBytes: pdfBytes.length,
          projectId: doc.projectId,
          organizationId: orgId,
          uploadedById: userId,
        },
      });

      await tx.document.update({
        where: { id },
        data: { signedFileId: signedFileRecord.id },
      });

      if (oldSignedFileId) {
        await tx.file.deleteMany({ where: { id: oldSignedFileId } });
      }

      return tx.documentResponse.create({
        data: {
          documentId: id,
          userId,
          action: "signed",
          signatureImageKey: sigKey,
          signatureMethod: dto.method,
          signedAt: signedDate,
          fieldId: dto.fieldId,
          ipAddress,
          userAgent,
        },
      });
    }, {
      timeout: 30000,
    });

    await this.updateDocumentStatus(id);

    // Signing audit is critical for compliance — log synchronously (not fire-and-forget)
    await this.prisma.documentAuditEvent.create({
      data: {
        documentId: id,
        action: "signed",
        userId,
        ipAddress,
        userAgent,
        metadata: JSON.stringify({ fieldId: dto.fieldId }),
      },
    }).catch((err) => this.logger.error({ err }, "Failed to log signing audit event"));

    // Check if signing order is enabled and notify next signer
    this.notifyNextSignerIfNeeded(id).catch((err) =>
      this.logger.warn({ err }, "Failed to notify next signer"),
    );

    return response;
  }

  /**
   * Embed text into a PDF field (for date and text field types).
   */
  private async embedTextInPdf(
    tx: Parameters<Parameters<PrismaService["$transaction"]>[0]>[0],
    doc: {
      id: string;
      title: string;
      projectId: string;
      signedFileId: string | null;
      signedFile: { storageKey: string } | null;
      file: { storageKey: string };
    },
    field: { pageNumber: number; x: number; y: number; width: number; height: number },
    text: string,
    ctx: {
      id: string;
      userId: string;
      orgId: string;
      signerName: string;
      signedDate: Date;
      ipAddress?: string;
      userAgent?: string;
      dto: { method: string; fieldId: string };
      textValue: string;
    },
  ) {
    const sourceFile = doc.signedFileId ? doc.signedFile! : doc.file;
    const { body: pdfStream } = await this.storage.download(sourceFile.storageKey);

    const pdfChunks: Buffer[] = [];
    let totalSize = 0;
    for await (const chunk of pdfStream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalSize += buf.length;
      if (totalSize > MAX_SIGNABLE_PDF_BYTES) {
        throw new BadRequestException("PDF is too large for signing");
      }
      pdfChunks.push(buf);
    }
    const pdfBuffer = Buffer.concat(pdfChunks);
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    if (field.pageNumber >= pdfDoc.getPageCount()) {
      throw new BadRequestException(
        `Field references page ${field.pageNumber} but the PDF only has ${pdfDoc.getPageCount()} page(s)`,
      );
    }

    const page = pdfDoc.getPages()[field.pageNumber];
    const { width: pageW, height: pageH } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const drawX = field.x * pageW;
    const drawH = field.height * pageH;
    const drawY = pageH - (field.y * pageH) - drawH;
    const fontSize = Math.min(Math.max(8, drawH * 0.6), 14);

    page.drawText(text, {
      x: drawX + 4,
      y: drawY + (drawH - fontSize) / 2,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    const pdfBytes = await pdfDoc.save();
    const signedPdfKey = `${ctx.orgId}/${doc.projectId}/documents/${ctx.id}-signed.pdf`;
    await this.storage.upload(signedPdfKey, Buffer.from(pdfBytes), "application/pdf");

    const oldSignedFileId = doc.signedFileId;
    const signedFileRecord = await tx.file.create({
      data: {
        filename: sanitizeFilename(`${doc.title}-signed.pdf`),
        storageKey: signedPdfKey,
        mimeType: "application/pdf",
        sizeBytes: pdfBytes.length,
        projectId: doc.projectId,
        organizationId: ctx.orgId,
        uploadedById: ctx.userId,
      },
    });

    await tx.document.update({
      where: { id: ctx.id },
      data: { signedFileId: signedFileRecord.id },
    });

    if (oldSignedFileId) {
      await tx.file.deleteMany({ where: { id: oldSignedFileId } });
    }

    return tx.documentResponse.create({
      data: {
        documentId: ctx.id,
        userId: ctx.userId,
        action: "signed",
        signatureMethod: ctx.dto.method,
        signedAt: ctx.signedDate,
        fieldId: ctx.dto.fieldId,
        textValue: ctx.textValue,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  }

  private async notifyNextSignerIfNeeded(documentId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { signatureFields: true, responses: true },
    });
    if (!doc || !doc.signingOrderEnabled) return;

    const signedFieldIds = new Set(
      doc.responses.filter((r) => r.action === "signed").map((r) => r.fieldId),
    );

    // Find the next unsigned field with a signing order
    const orderedFields = doc.signatureFields
      .filter((f) => f.signerOrder > 0 && !signedFieldIds.has(f.id))
      .sort((a, b) => a.signerOrder - b.signerOrder);

    if (orderedFields.length === 0) return;

    const nextField = orderedFields[0];
    if (nextField.assignedTo) {
      this.notifications.notifyDocumentSigningTurn(documentId, nextField.assignedTo);
    }
  }

  async getSigningInfo(id: string, userId: string, orgId: string, role: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId: orgId },
      include: { signatureFields: true },
    });
    if (!doc) throw new NotFoundException("Document not found");

    await assertProjectAccess(this.prisma, doc.projectId, userId, role);

    // For admins, return all signed field IDs across all users.
    // For clients, return only their own signed fields.
    const isAdmin = role === "owner" || role === "admin";
    const responseFilter = isAdmin
      ? { documentId: id, action: "signed" as const }
      : { documentId: id, userId, action: "signed" as const };
    const responses = await this.prisma.documentResponse.findMany({
      where: responseFilter,
    });
    const signedFieldIds = responses
      .filter((r) => r.fieldId)
      .map((r) => r.fieldId!);

    return {
      documentId: doc.id,
      requiresSignature: doc.requiresSignature,
      signatureFields: doc.signatureFields,
      signedFieldIds,
      signedFileId: doc.signedFileId,
      signingOrderEnabled: doc.signingOrderEnabled,
      status: doc.status,
    };
  }

  async remove(id: string, orgId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId: orgId },
      include: { file: true, signedFile: true, responses: true },
    });
    if (!doc) throw new NotFoundException("Document not found");

    // Collect storage keys to delete
    const keysToDelete: string[] = [doc.file.storageKey];
    if (doc.signedFile) {
      keysToDelete.push(doc.signedFile.storageKey);
    }

    // Collect signature PNG keys from responses
    const sigKeys = doc.responses
      .filter((r) => r.signatureImageKey)
      .map((r) => r.signatureImageKey!);
    keysToDelete.push(...sigKeys);

    await this.prisma.$transaction(async (tx) => {
      await tx.document.delete({ where: { id } });
      await tx.file.delete({ where: { id: doc.fileId } });
      if (doc.signedFileId) {
        await tx.file.deleteMany({ where: { id: doc.signedFileId } });
      }
    });

    // Delete storage blobs in parallel
    await Promise.allSettled(
      keysToDelete.map((key) =>
        this.storage.delete(key).catch((err) =>
          this.logger.error(
            { err, storageKey: key },
            "Failed to delete file from storage — orphaned blob",
          ),
        ),
      ),
    );
  }

  // --- Access Token (Direct Signing Link) ---

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  async generateAccessToken(documentId: string, userId: string, orgId: string) {
    // Verify document belongs to org
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId: orgId },
    });
    if (!doc) throw new NotFoundException("Document not found");

    // Verify userId is a project client on this document's project
    const assignment = await this.prisma.projectClient.findFirst({
      where: { projectId: doc.projectId, userId },
    });
    if (!assignment) {
      throw new BadRequestException("User is not a client on this project");
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(rawToken);
    const defaultExpiryMs = 30 * 24 * 60 * 60 * 1000; // 30 days
    const expiresAt = doc.expiresAt
      ? new Date(Math.min(doc.expiresAt.getTime(), Date.now() + defaultExpiryMs))
      : new Date(Date.now() + defaultExpiryMs);

    await this.prisma.documentAccessToken.create({
      data: { documentId, userId, token: tokenHash, expiresAt },
    });

    // Return the raw token only once — it's not stored
    return { token: rawToken, expiresAt };
  }

  async revokeAccessToken(documentId: string, tokenId: string, orgId: string) {
    await this.assertDocumentAccess(documentId, orgId);
    const token = await this.prisma.documentAccessToken.findFirst({
      where: { id: tokenId, documentId },
    });
    if (!token) throw new NotFoundException("Access token not found");
    if (token.revokedAt) throw new BadRequestException("Token is already revoked");
    return this.prisma.documentAccessToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
  }

  async validateAccessToken(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    const record = await this.prisma.documentAccessToken.findUnique({
      where: { token: tokenHash },
      include: {
        document: {
          include: { file: true, signedFile: true, signatureFields: true },
        },
      },
    });

    if (!record) throw new NotFoundException("Invalid or expired link");
    if (record.revokedAt) {
      throw new BadRequestException("This signing link has been revoked");
    }
    if (record.expiresAt < new Date()) {
      throw new BadRequestException("This signing link has expired");
    }

    // Block access to voided/expired/draft documents
    const blockedStatuses = new Set(["voided", "expired", "draft"]);
    if (blockedStatuses.has(record.document.status)) {
      throw new BadRequestException("This document is no longer available for signing");
    }

    // Mark as used
    if (!record.usedAt) {
      await this.prisma.documentAccessToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
    }

    return {
      document: record.document,
      userId: record.userId,
      documentId: record.documentId,
    };
  }

  // --- Completion Certificate ---

  async generateCertificate(id: string, orgId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId: orgId },
      include: {
        file: true,
        responses: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!doc) throw new NotFoundException("Document not found");
    if (doc.status !== "signed") {
      throw new BadRequestException("Certificate is only available for fully signed documents");
    }

    // Get audit trail
    const auditEvents = await this.prisma.documentAuditEvent.findMany({
      where: { documentId: id },
      orderBy: { createdAt: "asc" },
    });

    // Enrich audit events with user names
    const userIds = [...new Set(auditEvents.filter((e) => e.userId).map((e) => e.userId!))];
    const users = userIds.length > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const page = pdfDoc.addPage([612, 792]); // Letter size
    let y = 740;
    const leftMargin = 50;
    const black = rgb(0, 0, 0);
    const gray = rgb(0.4, 0.4, 0.4);

    // Title
    page.drawText("CERTIFICATE OF COMPLETION", {
      x: leftMargin,
      y,
      size: 18,
      font: boldFont,
      color: black,
    });
    y -= 30;

    // Horizontal rule
    page.drawLine({
      start: { x: leftMargin, y },
      end: { x: 562, y },
      thickness: 1,
      color: gray,
    });
    y -= 25;

    // Document info
    const drawLabel = (label: string, value: string) => {
      page.drawText(label, { x: leftMargin, y, size: 10, font: boldFont, color: gray });
      page.drawText(value, { x: leftMargin + 120, y, size: 10, font, color: black });
      y -= 18;
    };

    const certId = doc.id.slice(0, 12).toUpperCase();
    drawLabel("Certificate ID:", certId);
    drawLabel("Document:", doc.title);
    drawLabel("Type:", doc.type.charAt(0).toUpperCase() + doc.type.slice(1));
    drawLabel("Status:", "Completed");
    drawLabel("File:", doc.file.filename);

    y -= 15;
    page.drawText("SIGNERS", { x: leftMargin, y, size: 12, font: boldFont, color: black });
    y -= 20;

    // Signer table
    const signerResponses = doc.responses.filter((r) => r.action === "signed");
    for (const resp of signerResponses) {
      const name = resp.user?.name || "Unknown";
      const email = resp.user?.email || "";
      const signedAt = resp.signedAt
        ? resp.signedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC"
        : resp.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
      const method = resp.signatureMethod || "draw";

      page.drawText(`${name} (${email})`, { x: leftMargin + 10, y, size: 9, font: boldFont, color: black });
      y -= 14;
      page.drawText(`Signed: ${signedAt}  |  Method: ${method}`, {
        x: leftMargin + 10, y, size: 8, font, color: gray,
      });
      y -= 18;
    }

    // Audit trail section
    if (auditEvents.length > 0) {
      let currentPage = page;
      y -= 10;
      currentPage.drawText("AUDIT TRAIL", { x: leftMargin, y, size: 12, font: boldFont, color: black });
      y -= 20;

      for (const event of auditEvents) {
        if (y < 60) {
          currentPage = pdfDoc.addPage([612, 792]);
          y = 740;
        }

        const actor = event.userId ? (userMap.get(event.userId)?.name || "Unknown") : "System";
        const time = event.createdAt.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });
        currentPage.drawText(`${time}  —  ${event.action}  —  ${actor}`, {
          x: leftMargin + 10, y, size: 8, font, color: gray,
        });
        y -= 14;
      }
    }

    const pdfBytes = await pdfDoc.save();
    return { buffer: Buffer.from(pdfBytes), filename: `certificate-${certId}.pdf` };
  }
}
