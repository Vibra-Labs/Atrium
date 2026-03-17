import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import type { StorageProvider } from "./storage/storage.interface";
import { STORAGE_PROVIDER } from "./storage/storage.interface";
import { randomUUID } from "crypto";
import { extname } from "path";
import { paginationArgs, paginatedResponse, sanitizeFilename, assertProjectAccess, BLOCKED_EXTENSIONS } from "../common";
import { NotificationsService } from "../notifications/notifications.service";

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** Safe MIME types for document uploads (quotes, contracts, NDAs). */
export const DOCUMENT_ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Safe MIME types for invoice file uploads. */
export const INVOICE_ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

@Injectable()
export class FilesService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private settingsService: SettingsService,
    @Inject(STORAGE_PROVIDER) private storage: StorageProvider,
    private notifications: NotificationsService,
  ) {}

  async upload(
    file: UploadedFile,
    projectId: string,
    organizationId: string,
    uploadedById: string,
    documentMeta?: { documentType?: string; documentTitle?: string },
  ) {
    // Early size check: validate against org-specific limit before any processing
    const maxFileSizeMb = await this.settingsService.getEffectiveMaxFileSize(organizationId);
    const maxFileSize = maxFileSizeMb * 1024 * 1024;

    if (file.size > maxFileSize) {
      throw new PayloadTooLargeException(
        `File size (${Math.round(file.size / 1024 / 1024)}MB) exceeds the maximum allowed size of ${maxFileSizeMb}MB`,
      );
    }

    const ext = extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      throw new BadRequestException(
        `File type "${ext}" is not allowed`,
      );
    }

    // Validate document type if provided
    const VALID_DOC_TYPES = ["quote", "contract", "nda", "proposal", "other"];
    if (documentMeta?.documentType && !VALID_DOC_TYPES.includes(documentMeta.documentType)) {
      throw new BadRequestException(
        `Invalid document type. Must be one of: ${VALID_DOC_TYPES.join(", ")}`,
      );
    }

    // Verify project belongs to org
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });
    if (!project) throw new NotFoundException("Project not found");

    const safeName = sanitizeFilename(file.originalname);
    const storageKey = `${organizationId}/${projectId}/${randomUUID()}-${safeName}`;

    await this.storage.upload(storageKey, file.buffer, file.mimetype);

    const isDocument = !!documentMeta?.documentType;

    return this.prisma.file.create({
      data: {
        filename: safeName,
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        projectId,
        organizationId,
        uploadedById,
        ...(isDocument
          ? {
              documentType: documentMeta.documentType,
              documentTitle: documentMeta.documentTitle || safeName,
              documentStatus: "pending",
            }
          : {}),
      },
    });
  }

  async uploadAsClient(
    file: UploadedFile,
    projectId: string,
    organizationId: string,
    userId: string,
  ) {
    // Verify client is assigned to this project
    const assignment = await this.prisma.projectClient.findFirst({
      where: { projectId, userId },
    });
    if (!assignment) {
      throw new ForbiddenException("You are not assigned to this project");
    }

    // Verify project belongs to org and is not archived
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId, archivedAt: null },
    });
    if (!project) throw new NotFoundException("Project not found");

    // Reuse the same upload logic
    return this.upload(file, projectId, organizationId, userId);
  }

  async findByProject(
    projectId: string,
    organizationId: string,
    userId: string,
    role: string,
    page = 1,
    limit = 20,
  ) {
    await assertProjectAccess(this.prisma,projectId, userId, role);

    const where = { projectId, organizationId };
    const [data, total] = await Promise.all([
      this.prisma.file.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.file.count({ where }),
    ]);
    return paginatedResponse(data, total, page, limit);
  }

  async download(id: string, organizationId: string, userId: string, role: string) {
    const file = await this.prisma.file.findFirst({
      where: { id, organizationId },
    });
    if (!file) throw new NotFoundException("File not found");

    await assertProjectAccess(this.prisma,file.projectId, userId, role);

    const { body, contentType } = await this.storage.download(file.storageKey);
    return { body, contentType, filename: file.filename };
  }

  async getDownloadUrl(id: string, organizationId: string, userId: string, role: string) {
    const file = await this.prisma.file.findFirst({
      where: { id, organizationId },
    });
    if (!file) throw new NotFoundException("File not found");

    await assertProjectAccess(this.prisma,file.projectId, userId, role);

    return { url: `/api/files/${id}/download` };
  }

  async respondToDocument(
    id: string,
    organizationId: string,
    userId: string,
    role: string,
    action: "accepted" | "rejected",
    reason?: string,
  ) {
    const file = await this.prisma.file.findFirst({
      where: { id, organizationId },
    });
    if (!file) throw new NotFoundException("File not found");
    if (!file.documentType) {
      throw new BadRequestException("This file is not a document");
    }

    // Only clients assigned to the project can respond to documents
    const assignment = await this.prisma.projectClient.findFirst({
      where: { projectId: file.projectId, userId },
    });
    if (!assignment) {
      throw new ForbiddenException("Only assigned clients can respond to documents");
    }

    return this.prisma.file.update({
      where: { id },
      data: {
        documentStatus: action,
        respondedAt: new Date(),
        respondedById: userId,
        respondReason: reason || null,
      },
    });
  }

  async updateDocumentStatus(id: string, organizationId: string, status: string) {
    const file = await this.prisma.file.findFirst({
      where: { id, organizationId },
    });
    if (!file) throw new NotFoundException("File not found");
    if (!file.documentType) {
      throw new BadRequestException("This file is not a document");
    }

    const data: Record<string, unknown> = { documentStatus: status };
    if (status === "pending") {
      data.respondedAt = null;
      data.respondedById = null;
      data.respondReason = null;
    }

    const updated = await this.prisma.file.update({ where: { id }, data });

    // Re-notify clients when a document is reset to pending
    if (status === "pending") {
      // Find the Document record linked to this file (if any) to trigger the upload notification
      const doc = await this.prisma.document.findFirst({ where: { fileId: id } });
      if (doc) {
        this.notifications.notifyDocumentUploaded(doc.id);
      }
    }

    return updated;
  }

  async markDocumentViewed(
    id: string,
    organizationId: string,
    userId: string,
    role: string,
  ) {
    const file = await this.prisma.file.findFirst({
      where: { id, organizationId },
    });
    if (!file) throw new NotFoundException("File not found");
    if (!file.documentType) {
      throw new BadRequestException("This file is not a document");
    }

    await assertProjectAccess(this.prisma, file.projectId, userId, role);

    // Only update to "viewed" if currently "pending"
    if (file.documentStatus !== "pending") return file;

    return this.prisma.file.update({
      where: { id },
      data: { documentStatus: "viewed" },
    });
  }

  async remove(id: string, organizationId: string) {
    const file = await this.prisma.file.findFirst({
      where: { id, organizationId },
    });
    if (!file) throw new NotFoundException("File not found");

    // Block deletion if an invoice references this file
    const invoiceRef = await this.prisma.invoice.findFirst({
      where: { uploadedFileId: id },
      select: { id: true, invoiceNumber: true },
    });
    if (invoiceRef) {
      throw new BadRequestException(
        `Cannot delete: file is attached to invoice ${invoiceRef.invoiceNumber}. Delete the invoice first.`,
      );
    }

    await this.prisma.file.delete({ where: { id } });

    try {
      await this.storage.delete(file.storageKey);
    } catch {
      // DB record already deleted — orphaned blob is acceptable;
      // a future cleanup job can sweep orphans by comparing storage keys.
    }
  }
}
