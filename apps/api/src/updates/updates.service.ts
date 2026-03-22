import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ActivityService } from "../activity/activity.service";
import type { StorageProvider } from "../files/storage/storage.interface";
import { STORAGE_PROVIDER } from "../files/storage/storage.interface";
import type { UploadedFile } from "../files/files.service";
import { randomUUID } from "crypto";
import { extname } from "path";
import type { Response } from "express";
import { paginationArgs, paginatedResponse, sanitizeFilename, contentDisposition, assertProjectAccess, BLOCKED_EXTENSIONS } from "../common";


const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

@Injectable()
export class UpdatesService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private activityService: ActivityService,
    @Inject(STORAGE_PROVIDER) private storage: StorageProvider,
  ) {}

  async create(
    dto: { content: string },
    projectId: string,
    organizationId: string,
    authorId: string,
    role: string,
    attachment?: UploadedFile,
  ) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });
    if (!project) throw new NotFoundException("Project not found");

    await assertProjectAccess(this.prisma, projectId, authorId, role, organizationId);

    let attachmentKey: string | undefined;
    let attachmentMimeType: string | undefined;
    let attachmentName: string | undefined;
    let fileId: string | undefined;

    if (attachment) {
      if (attachment.size > MAX_ATTACHMENT_SIZE) {
        throw new BadRequestException("Attachment must be under 10MB");
      }

      const ext = extname(attachment.originalname).toLowerCase();
      if (BLOCKED_EXTENSIONS.has(ext)) {
        throw new BadRequestException(`File type "${ext}" is not allowed`);
      }

      const safeName = sanitizeFilename(attachment.originalname);
      attachmentKey = `${organizationId}/${projectId}/updates/${randomUUID()}-${safeName}`;
      attachmentMimeType = attachment.mimetype;
      attachmentName = attachment.originalname;

      await this.storage.upload(attachmentKey, attachment.buffer, attachment.mimetype);

      // Create a File record so the attachment appears in the project's Files tab
      const file = await this.prisma.file.create({
        data: {
          filename: safeName,
          storageKey: attachmentKey,
          mimeType: attachment.mimetype,
          sizeBytes: attachment.size,
          projectId,
          organizationId,
          uploadedById: authorId,
        },
      });
      fileId = file.id;
    }

    const update = await this.prisma.projectUpdate.create({
      data: {
        content: dto.content,
        attachmentKey,
        attachmentMimeType,
        attachmentName,
        fileId,
        projectId,
        organizationId,
        authorId,
      },
    });

    this.notifications.notifyProjectUpdate(projectId, dto.content);

    return update;
  }

  async findByProject(
    projectId: string,
    organizationId: string,
    page = 1,
    limit = 20,
  ) {
    const where = { projectId, organizationId };
    const [updates, total] = await Promise.all([
      this.prisma.projectUpdate.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          file: { select: { id: true } },
          _count: { select: { comments: true } },
        },
        ...paginationArgs(page, limit),
      }),
      this.prisma.projectUpdate.count({ where }),
    ]);

    // Batch-resolve author names
    const authorIds = [...new Set(updates.map((u) => u.authorId))];
    const authors = await this.prisma.user.findMany({
      where: { id: { in: authorIds } },
      select: { id: true, name: true },
    });
    const authorMap = new Map(authors.map((a) => [a.id, a]));

    // Generate attachment URLs: prefer file download endpoint, fall back to signed URL for legacy data
    const enriched = await Promise.all(
      updates.map(async (u) => {
        let attachmentUrl: string | undefined;
        if (u.fileId) {
          attachmentUrl = `/api/files/${u.fileId}/download`;
        } else if (u.attachmentKey) {
          attachmentUrl = await this.storage.getSignedUrl(u.attachmentKey);
        }
        const author = authorMap.get(u.authorId);
        return {
          id: u.id,
          content: u.content,
          attachmentUrl,
          attachmentName: u.attachmentName,
          attachmentMimeType: u.attachmentMimeType,
          hasAttachment: !!u.attachmentKey || !!u.fileId,
          fileId: u.fileId,
          projectId: u.projectId,
          author: author ?? { id: u.authorId, name: "Unknown" },
          commentCount: u._count.comments,
          createdAt: u.createdAt,
        };
      }),
    );

    return paginatedResponse(enriched, total, page, limit);
  }

  async findByProjectForClient(
    projectId: string,
    clientUserId: string,
    organizationId: string,
    page = 1,
    limit = 20,
  ) {
    const assignment = await this.prisma.projectClient.findFirst({
      where: { projectId, userId: clientUserId },
    });
    if (!assignment) {
      throw new ForbiddenException("Not assigned to this project");
    }

    return this.findByProject(projectId, organizationId, page, limit);
  }

  /**
   * Returns a combined timeline of project updates and activity log entries,
   * sorted chronologically (newest first).
   *
   * Uses count-based total and fetches only (limit + limit) rows from each
   * source, then merges and takes the top `limit` — avoids loading the
   * entire history into memory.
   */
  async findTimeline(
    projectId: string,
    organizationId: string,
    page = 1,
    limit = 20,
  ) {
    const where = { projectId, organizationId };
    const skip = (page - 1) * limit;

    // Fetch counts and page-sized batches in parallel
    const [updates, updateCount, activities, activityCount] = await Promise.all([
      this.prisma.projectUpdate.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          file: { select: { id: true } },
          _count: { select: { comments: true } },
        },
      }),
      this.prisma.projectUpdate.count({ where }),
      this.prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    // Batch-resolve author names for updates
    const authorIds = [...new Set(updates.map((u) => u.authorId))];
    const actorIds = [...new Set(activities.map((a) => a.actorId))];
    const allUserIds = [...new Set([...authorIds, ...actorIds])];
    const users = allUserIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: allUserIds } }, select: { id: true, name: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Build update entries with attachment URLs
    const updateEntries = await Promise.all(
      updates.map(async (u) => {
        let attachmentUrl: string | undefined;
        if (u.fileId) {
          attachmentUrl = `/api/files/${u.fileId}/download`;
        } else if (u.attachmentKey) {
          attachmentUrl = await this.storage.getSignedUrl(u.attachmentKey);
        }
        const author = userMap.get(u.authorId);
        return {
          id: u.id,
          kind: "update" as const,
          createdAt: u.createdAt,
          content: u.content,
          attachmentUrl,
          attachmentName: u.attachmentName,
          attachmentMimeType: u.attachmentMimeType,
          hasAttachment: !!u.attachmentKey || !!u.fileId,
          fileId: u.fileId,
          author: author ?? { id: u.authorId, name: "Unknown" },
          commentCount: u._count.comments,
        };
      }),
    );

    const activityEntries = activities.map((a) => ({
      id: a.id,
      kind: "activity" as const,
      createdAt: a.createdAt,
      type: a.type,
      action: a.action,
      actor: userMap.get(a.actorId) ?? { id: a.actorId, name: "Unknown" },
      targetId: a.targetId,
      targetTitle: a.targetTitle,
      detail: a.detail,
    }));

    // Merge and sort the two page-sized arrays, take top `limit`
    const merged = [...updateEntries, ...activityEntries]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);

    const total = updateCount + activityCount;
    return paginatedResponse(merged, total, page, limit);
  }

  /**
   * Timeline for clients — verifies project access first.
   */
  async findTimelineForClient(
    projectId: string,
    clientUserId: string,
    organizationId: string,
    page = 1,
    limit = 20,
  ) {
    const assignment = await this.prisma.projectClient.findFirst({
      where: { projectId, userId: clientUserId },
    });
    if (!assignment) {
      throw new ForbiddenException("Not assigned to this project");
    }

    return this.findTimeline(projectId, organizationId, page, limit);
  }

  async remove(id: string, organizationId: string) {
    const update = await this.prisma.projectUpdate.findFirst({
      where: { id, organizationId },
    });
    if (!update) throw new NotFoundException("Update not found");

    if (update.attachmentKey) {
      await this.storage.delete(update.attachmentKey);
    }

    await this.prisma.projectUpdate.delete({ where: { id } });

    // Clean up the linked File record (storage already deleted above)
    if (update.fileId) {
      await this.prisma.file.delete({ where: { id: update.fileId } }).catch(() => {});
    }
  }

  async getAttachment(id: string, organizationId: string, userId: string, role: string, res: Response) {
    const update = await this.prisma.projectUpdate.findFirst({
      where: { id, organizationId },
    });
    if (!update || !update.attachmentKey) {
      throw new NotFoundException("Attachment not found");
    }

    await assertProjectAccess(this.prisma, update.projectId, userId, role, organizationId);

    const { body, contentType } = await this.storage.download(update.attachmentKey);
    res.setHeader("Content-Type", contentType);
    if (update.attachmentName) {
      res.setHeader("Content-Disposition", contentDisposition(update.attachmentName, "inline"));
    }
    body.pipe(res);
  }

  static isImageType(mimeType: string | null | undefined): boolean {
    return !!mimeType && IMAGE_TYPES.has(mimeType);
  }
}
