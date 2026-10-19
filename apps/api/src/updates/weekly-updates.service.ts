import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { buildWeeklyDraft } from "./weekly-draft";
import { WEEK_MS } from "../common/helpers/local-time";

const UPCOMING_LIMIT = 5;

export interface WeeklyDraft {
  content: string;
  since: Date;
  stats: { completedTasks: number; newFiles: number; hoursLogged: number };
}

export interface WeeklyUpdateDue {
  projectId: string;
  projectName: string;
  lastUpdateAt: Date | null;
  clientCount: number;
}

@Injectable()
export class WeeklyUpdatesService {
  constructor(private prisma: PrismaService) {}

  /** A client-ready draft of the last 7 days. Never posted automatically: posting emails every client. */
  async getDraft(projectId: string, orgId: string, now: Date = new Date()): Promise<WeeklyDraft> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: { id: true, name: true },
    });
    if (!project) throw new NotFoundException("Project not found");

    const since: Date = new Date(now.getTime() - WEEK_MS);
    const [done, upcoming, files, time] = await Promise.all([
      // Tasks have no completion timestamp; a done task touched this week is the closest signal.
      this.prisma.task.findMany({
        where: { projectId, status: "done", updatedAt: { gte: since } },
        select: { title: true },
        orderBy: { updatedAt: "asc" },
      }),
      this.prisma.task.findMany({
        where: { projectId, status: { in: ["open", "in_progress"] } },
        select: { title: true },
        orderBy: [{ status: "desc" }, { order: "asc" }],
        take: UPCOMING_LIMIT,
      }),
      this.prisma.file.findMany({
        where: { projectId, createdAt: { gte: since } },
        select: { filename: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.timeEntry.aggregate({
        where: { projectId, startedAt: { gte: since } },
        _sum: { durationSec: true },
      }),
    ]);

    const content: string = buildWeeklyDraft({
      projectName: project.name,
      completedTasks: done.map((t) => t.title),
      newFiles: files.map((f) => f.filename),
      upcomingTasks: upcoming.map((t) => t.title),
    });
    const seconds: number = time._sum.durationSec ?? 0;

    return {
      content,
      since,
      stats: {
        completedTasks: done.length,
        newFiles: files.length,
        hoursLogged: Math.round((seconds / 3600) * 10) / 10,
      },
    };
  }

  /** Active client projects without an update in the last 7 days, longest-waiting first. */
  async getDue(orgId: string, now: Date = new Date()): Promise<WeeklyUpdateDue[]> {
    const cutoff: Date = new Date(now.getTime() - WEEK_MS);
    const projects = await this.prisma.project.findMany({
      where: {
        organizationId: orgId,
        archivedAt: null,
        status: { notIn: ["completed", "cancelled"] },
        clients: { some: {} },
      },
      select: {
        id: true,
        name: true,
        updates: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { clients: true } },
      },
    });

    return projects
      .map((p): WeeklyUpdateDue => ({
        projectId: p.id,
        projectName: p.name,
        lastUpdateAt: p.updates[0]?.createdAt ?? null,
        clientCount: p._count.clients,
      }))
      .filter((p) => !p.lastUpdateAt || p.lastUpdateAt < cutoff)
      .sort((a, b) => (a.lastUpdateAt?.getTime() ?? 0) - (b.lastUpdateAt?.getTime() ?? 0));
  }
}
