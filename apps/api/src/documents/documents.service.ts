import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { PDFDocument } from "pdf-lib";
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

/** Max PDF size allowed for signing (50MB) to prevent OOM. */
const MAX_SIGNABLE_PDF_BYTES = 50 * 1024 * 1024;
const ALLOWED_SIGNATURE_MIMES = new Set(["image/png", "image/jpeg"]);

const ALLOWED_ACTIONS: Record<string, string[]> = {
  quote: ["accepted", "declined"],
  contract: ["accepted", "declined"],
  proposal: ["accepted", "declined"],
  nda: ["acknowledged"],
  other: ["acknowledged"],
};

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
        requiresSignature: dto.requiresSignature ?? false,
      },
      include: DOCUMENT_FULL_INCLUDE,
    });

    this.notifications.notifyDocumentUploaded(document.id);

    return document;
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

    const where = { projectId, organizationId: orgId };
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

    // Prevent changes to finalized documents
    const finalStatuses = new Set(["accepted", "declined", "acknowledged", "signed"]);
    if (finalStatuses.has(doc.status)) {
      throw new BadRequestException(
        `Cannot respond to a document with status "${doc.status}"`,
      );
    }

    // Verify client is assigned to the project
    const assignment = await this.prisma.projectClient.findFirst({
      where: { projectId: doc.projectId, userId },
    });
    if (!assignment) {
      throw new ForbiddenException("Not assigned to this project");
    }

    // Validate action for document type
    const allowed = ALLOWED_ACTIONS[doc.type] || ["acknowledged"];
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
      }
      return;
    }

    // If all assigned clients have responded positively
    const clientCount = await this.prisma.projectClient.count({
      where: { projectId: doc.projectId },
    });
    if (doc.responses.length >= clientCount) {
      const status = doc.responses.every((r) => r.action === "accepted")
        ? "accepted"
        : "acknowledged";
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status },
      });
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
    return { body, contentType, filename: fileToView.filename };
  }

  async setSignatureFields(
    docId: string,
    orgId: string,
    fields: { pageNumber: number; x: number; y: number; width: number; height: number }[],
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, organizationId: orgId },
    });
    if (!doc) throw new NotFoundException("Document not found");

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
    dto: { method: string; fieldId: string },
    signatureFile: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    ipAddress?: string,
    userAgent?: string,
  ) {
    // Validate signature file MIME type
    if (!ALLOWED_SIGNATURE_MIMES.has(signatureFile.mimetype)) {
      throw new BadRequestException("Signature must be a PNG or JPEG image");
    }

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
      if (doc.status === "signed") {
        throw new BadRequestException("This document has already been fully signed");
      }

      const field = doc.signatureFields.find((f) => f.id === dto.fieldId);
      if (!field) {
        throw new BadRequestException("Signature field not found on this document");
      }

      const [assignment, existingResponse, signer] = await Promise.all([
        tx.projectClient.findFirst({ where: { projectId: doc.projectId, userId } }),
        tx.documentResponse.findFirst({ where: { documentId: id, userId, fieldId: dto.fieldId } }),
        tx.user.findUnique({ where: { id: userId }, select: { name: true } }),
      ]);
      if (!assignment) throw new ForbiddenException("Not assigned to this project");
      if (existingResponse) throw new BadRequestException("You have already signed this field");

      const signerName = signer?.name || "Unknown";

      // Upload signature image to storage
      const sigKey = `${orgId}/${doc.projectId}/signatures/${id}-${userId}-${dto.fieldId}.png`;
      await this.storage.upload(sigKey, signatureFile.buffer, signatureFile.mimetype);

      // Download the latest signed PDF (or original) — safe because FOR UPDATE lock
      // ensures no concurrent signer can modify signedFileId between our read and write
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

      const signedDate = new Date();
      const fontSize = Math.max(6, drawH * 0.15);
      const annotY = drawY - fontSize - 2 > 0
        ? drawY - fontSize - 2
        : drawY + drawH + 2;
      page.drawText(`Signed by ${signerName} on ${signedDate.toISOString().split("T")[0]}`, {
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

    return response;
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
}
