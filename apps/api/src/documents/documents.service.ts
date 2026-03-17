import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { PrismaService } from "../prisma/prisma.service";
import { paginationArgs, paginatedResponse } from "../common";
import type { StorageProvider } from "../files/storage/storage.interface";
import { STORAGE_PROVIDER } from "../files/storage/storage.interface";
import { CreateDocumentDto } from "./documents.dto";
import { NotificationsService } from "../notifications/notifications.service";
import { ActivityService } from "../activity/activity.service";

const ALLOWED_ACTIONS: Record<string, string[]> = {
  quote: ["accepted", "declined"],
  contract: ["accepted", "declined"],
  proposal: ["accepted", "declined"],
  nda: ["acknowledged"],
  other: ["acknowledged"],
};

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
      },
      include: {
        file: true,
        responses: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
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
        include: {
          file: true,
          responses: {
            include: { user: { select: { id: true, name: true } } },
          },
        },
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
          responses: {
            where: { userId },
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
      include: {
        file: true,
        responses: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
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

    const response = await this.prisma.documentResponse.upsert({
      where: {
        documentId_userId: { documentId: id, userId },
      },
      create: {
        documentId: id,
        userId,
        action,
        reason: reason || null,
        ipAddress,
        userAgent,
      },
      update: {
        action,
        reason: reason || null,
        ipAddress,
        userAgent,
      },
    });

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
      include: { responses: true },
    });
    if (!doc || doc.responses.length === 0) return;

    // If any client declined, status is declined
    if (doc.responses.some((r) => r.action === "declined")) {
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: "declined" },
      });
      return;
    }

    // Determine status from existing responses (don't wait for all clients)
    const allAccepted = doc.responses.every((r) => r.action === "accepted");
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: allAccepted ? "accepted" : "acknowledged" },
    });
  }

  async remove(id: string, orgId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId: orgId },
      include: { file: true },
    });
    if (!doc) throw new NotFoundException("Document not found");

    await this.prisma.$transaction(async (tx) => {
      await tx.document.delete({ where: { id } });
      await tx.file.delete({ where: { id: doc.fileId } });
    });

    try {
      await this.storage.delete(doc.file.storageKey);
    } catch (err) {
      this.logger.error(
        { err, storageKey: doc.file.storageKey },
        "Failed to delete file from storage — orphaned blob",
      );
    }
  }
}
