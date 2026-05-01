import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  StartTimerDto,
  CreateManualEntryDto,
  UpdateTimeEntryDto,
  TimeEntryListQueryDto,
  GenerateInvoiceDto,
} from "./time-entries.dto";

@Injectable()
export class TimeEntriesService {
  constructor(private prisma: PrismaService) {}

  private async resolveRate(orgId: string, userId: string, projectId: string): Promise<number | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: { hourlyRateCents: true },
    });
    if (project?.hourlyRateCents != null) return project.hourlyRateCents;
    const member = await this.prisma.member.findFirst({
      where: { organizationId: orgId, userId },
      select: { hourlyRateCents: true },
    });
    return member?.hourlyRateCents ?? null;
  }

  async start(userId: string, orgId: string, dto: StartTimerDto) {
    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, organizationId: orgId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException("Project not found");

    if (dto.taskId) {
      const task = await this.prisma.task.findFirst({
        where: { id: dto.taskId, projectId: dto.projectId },
        select: { id: true },
      });
      if (!task) throw new NotFoundException("Task not found");
    }

    const rate = await this.resolveRate(orgId, userId, dto.projectId);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const running = await tx.timeEntry.findFirst({
        where: { userId, organizationId: orgId, endedAt: null },
      });
      if (running) {
        const durationSec = Math.max(0, Math.round((now.getTime() - running.startedAt.getTime()) / 1000));
        await tx.timeEntry.update({
          where: { id: running.id },
          data: { endedAt: now, durationSec },
        });
      }
      return tx.timeEntry.create({
        data: {
          organizationId: orgId,
          projectId: dto.projectId,
          taskId: dto.taskId ?? null,
          userId,
          description: dto.description ?? null,
          startedAt: now,
          hourlyRateCents: rate,
        },
      });
    });
  }

  async stop(userId: string, orgId: string) {
    const running = await this.prisma.timeEntry.findFirst({
      where: { userId, organizationId: orgId, endedAt: null },
    });
    if (!running) throw new NotFoundException("No running timer");
    const now = new Date();
    const durationSec = Math.max(0, Math.round((now.getTime() - running.startedAt.getTime()) / 1000));
    return this.prisma.timeEntry.update({
      where: { id: running.id },
      data: { endedAt: now, durationSec },
    });
  }

  async getRunning(userId: string, orgId: string) {
    return this.prisma.timeEntry.findFirst({
      where: { userId, organizationId: orgId, endedAt: null },
      include: { project: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } },
    });
  }
}
