import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { paginationArgs, paginatedResponse } from "../common";

export interface CreateActivityDto {
  type: "document_response" | "decision_vote" | "decision_closed";
  action: string;
  actorId: string;
  targetId: string;
  targetTitle: string;
  detail?: string;
  projectId: string;
  organizationId: string;
}

@Injectable()
export class ActivityService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateActivityDto) {
    return this.prisma.activityLog.create({
      data: {
        type: dto.type,
        action: dto.action,
        actorId: dto.actorId,
        targetId: dto.targetId,
        targetTitle: dto.targetTitle,
        detail: dto.detail,
        projectId: dto.projectId,
        organizationId: dto.organizationId,
      },
    });
  }

  async findByProject(
    projectId: string,
    organizationId: string,
    page = 1,
    limit = 20,
  ) {
    const where = { projectId, organizationId };
    const [data, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    // Batch-resolve actor names
    const actorIds = [...new Set(data.map((a) => a.actorId))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true },
    });
    const actorMap = new Map(actors.map((a) => [a.id, a]));

    const enriched = data.map((a) => ({
      ...a,
      actor: actorMap.get(a.actorId) ?? { id: a.actorId, name: "Unknown" },
    }));

    return paginatedResponse(enriched, total, page, limit);
  }
}
