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
import { paginationArgs, paginatedResponse, sanitizeFilename, assertProjectAccess } from "../common";

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".sh", ".bat", ".cmd", ".com", ".msi", ".ps1",
  ".scr", ".pif", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh",
]);

@Injectable()
export class FilesService {
  private defaultMaxFileSize: number;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private settingsService: SettingsService,
    @Inject(STORAGE_PROVIDER) private storage: StorageProvider,
  ) {
    const maxMb = parseInt(this.config.get("MAX_FILE_SIZE_MB", "50"), 10);
    this.defaultMaxFileSize = maxMb * 1024 * 1024;
  }

  async upload(
    file: UploadedFile,
    projectId: string,
    organizationId: string,
    uploadedById: string,
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

    // Verify project belongs to org
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });
    if (!project) throw new NotFoundException("Project not found");

    const safeName = sanitizeFilename(file.originalname);
    const storageKey = `${organizationId}/${projectId}/${randomUUID()}-${safeName}`;

    await this.storage.upload(storageKey, file.buffer, file.mimetype);

    return this.prisma.file.create({
      data: {
        filename: safeName,
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        projectId,
        organizationId,
        uploadedById,
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

  async remove(id: string, organizationId: string) {
    const file = await this.prisma.$transaction(async (tx) => {
      const found = await tx.file.findFirst({
        where: { id, organizationId },
      });
      if (!found) throw new NotFoundException("File not found");

      await tx.file.deleteMany({ where: { id, organizationId } });
      return found;
    });

    await this.storage.delete(file.storageKey);
  }
}
