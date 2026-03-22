import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { paginationArgs, paginatedResponse, assertProjectAccess } from "../common";

@Injectable()
export class CommentsService {
  constructor(private prisma: PrismaService) {}

  private async resolveProjectId(
    targetType: "update" | "task",
    targetId: string,
    orgId: string,
  ): Promise<string> {
    if (targetType === "update") {
      const update = await this.prisma.projectUpdate.findFirst({
        where: { id: targetId, organizationId: orgId },
        select: { projectId: true },
      });
      if (!update) throw new NotFoundException("Update not found");
      return update.projectId;
    }
    const task = await this.prisma.task.findFirst({
      where: { id: targetId, organizationId: orgId },
      select: { projectId: true },
    });
    if (!task) throw new NotFoundException("Task not found");
    return task.projectId;
  }

  async create(
    targetType: "update" | "task",
    targetId: string,
    content: string,
    orgId: string,
    userId: string,
    role: string,
  ) {
    const projectId = await this.resolveProjectId(targetType, targetId, orgId);
    await assertProjectAccess(this.prisma, projectId, userId, role, orgId);

    return this.prisma.comment.create({
      data: {
        content,
        authorId: userId,
        organizationId: orgId,
        ...(targetType === "update" ? { updateId: targetId } : { taskId: targetId }),
      },
    });
  }

  async findByTarget(
    targetType: "update" | "task",
    targetId: string,
    orgId: string,
    userId: string,
    role: string,
    page = 1,
    limit = 50,
  ) {
    const projectId = await this.resolveProjectId(targetType, targetId, orgId);
    await assertProjectAccess(this.prisma, projectId, userId, role, orgId);

    const where = {
      organizationId: orgId,
      ...(targetType === "update" ? { updateId: targetId } : { taskId: targetId }),
    };

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        where,
        orderBy: { createdAt: "asc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.comment.count({ where }),
    ]);

    const authorIds = [...new Set(comments.map((c) => c.authorId))];
    const authors = authorIds.length > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, name: true },
        })
      : [];
    const authorMap = new Map(authors.map((a) => [a.id, a]));

    const enriched = comments.map((c) => ({
      id: c.id,
      content: c.content,
      author: authorMap.get(c.authorId) ?? { id: c.authorId, name: "Unknown" },
      createdAt: c.createdAt,
    }));

    return paginatedResponse(enriched, total, page, limit);
  }

  async remove(
    commentId: string,
    orgId: string,
    userId: string,
    role: string,
  ) {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, organizationId: orgId },
    });
    if (!comment) throw new NotFoundException("Comment not found");

    const isOwnerOrAdmin = role === "owner" || role === "admin";
    if (comment.authorId !== userId && !isOwnerOrAdmin) {
      throw new ForbiddenException("Cannot delete this comment");
    }

    await this.prisma.comment.delete({ where: { id: commentId } });
  }
}
