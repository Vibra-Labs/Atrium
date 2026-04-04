import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async search(orgId: string, q: string) {
    const [projects, tasks, files, members] = await Promise.all([
      this.prisma.project.findMany({
        where: {
          organizationId: orgId,
          archivedAt: null,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
        },
        take: 5,
      }),
      this.prisma.task.findMany({
        where: {
          organizationId: orgId,
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          title: true,
          description: true,
          projectId: true,
          project: { select: { id: true, name: true } },
        },
        take: 5,
      }),
      this.prisma.file.findMany({
        where: {
          organizationId: orgId,
          filename: { contains: q, mode: "insensitive" },
        },
        select: {
          id: true,
          filename: true,
          projectId: true,
          project: { select: { id: true, name: true } },
        },
        take: 5,
      }),
      this.prisma.member.findMany({
        where: {
          organizationId: orgId,
          role: "member",
          user: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          },
        },
        select: {
          id: true,
          userId: true,
          user: { select: { id: true, name: true, email: true } },
        },
        take: 5,
      }),
    ]);

    const memberUserIds = members.map((m) => m.userId);
    const clientProfiles =
      memberUserIds.length > 0
        ? await this.prisma.clientProfile.findMany({
            where: { userId: { in: memberUserIds } },
            select: { userId: true, company: true },
          })
        : [];

    const profileByUserId = new Map(clientProfiles.map((p) => [p.userId, p]));

    const clients = members.map((m) => ({
      ...m,
      company: profileByUserId.get(m.userId)?.company ?? null,
    }));

    return { projects, tasks, files, clients };
  }
}
