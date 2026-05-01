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

  async create(userId: string, orgId: string, dto: CreateManualEntryDto) {
    const start = new Date(dto.startedAt);
    const end = new Date(dto.endedAt);
    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException("endedAt must be after startedAt");
    }
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
    const durationSec = Math.round((end.getTime() - start.getTime()) / 1000);

    return this.prisma.timeEntry.create({
      data: {
        organizationId: orgId,
        projectId: dto.projectId,
        taskId: dto.taskId ?? null,
        userId,
        description: dto.description ?? null,
        startedAt: start,
        endedAt: end,
        durationSec,
        billable: dto.billable ?? true,
        hourlyRateCents: rate,
      },
    });
  }

  private async findOwnEntryOrThrow(id: string, userId: string, orgId: string) {
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!entry) throw new NotFoundException("Time entry not found");
    if (entry.userId !== userId) {
      throw new ForbiddenException("You can only edit your own time entries");
    }
    if (entry.invoiceLineItemId) {
      throw new ConflictException("Time entry is locked because it has been invoiced");
    }
    return entry;
  }

  async update(id: string, userId: string, orgId: string, dto: UpdateTimeEntryDto) {
    const entry = await this.findOwnEntryOrThrow(id, userId, orgId);

    const start = dto.startedAt ? new Date(dto.startedAt) : entry.startedAt;
    const end = dto.endedAt ? new Date(dto.endedAt) : entry.endedAt;
    if (end && end.getTime() <= start.getTime()) {
      throw new BadRequestException("endedAt must be after startedAt");
    }
    const durationSec = end ? Math.round((end.getTime() - start.getTime()) / 1000) : entry.durationSec;

    return this.prisma.timeEntry.update({
      where: { id },
      data: {
        description: dto.description ?? entry.description,
        startedAt: start,
        endedAt: end,
        durationSec,
        billable: dto.billable ?? entry.billable,
        taskId: dto.taskId === undefined ? entry.taskId : dto.taskId,
      },
    });
  }

  async delete(id: string, userId: string, orgId: string) {
    await this.findOwnEntryOrThrow(id, userId, orgId);
    await this.prisma.timeEntry.delete({ where: { id } });
  }

  async list(orgId: string, query: TimeEntryListQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const where: Record<string, unknown> = { organizationId: orgId };
    if (query.projectId) where.projectId = query.projectId;
    if (query.userId) where.userId = query.userId;
    if (query.from || query.to) {
      where.startedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.billable === "true") where.billable = true;
    if (query.billable === "false") where.billable = false;
    if (query.invoiced === "true") where.NOT = { invoiceLineItemId: null };
    if (query.invoiced === "false") where.invoiceLineItemId = null;

    const [data, total] = await Promise.all([
      this.prisma.timeEntry.findMany({
        where,
        include: {
          project: { select: { id: true, name: true } },
          task: { select: { id: true, title: true } },
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { startedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.timeEntry.count({ where }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async report(orgId: string, query: TimeEntryListQueryDto) {
    const where: Record<string, unknown> = { organizationId: orgId };
    if (query.projectId) where.projectId = query.projectId;
    if (query.userId) where.userId = query.userId;
    if (query.from || query.to) {
      where.startedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const entries = await this.prisma.timeEntry.findMany({
      where: { ...where, NOT: { durationSec: null } },
      include: {
        project: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
    });

    const totals = { seconds: 0, billableSeconds: 0, valueCents: 0 };
    const byProjectMap = new Map<
      string,
      { projectId: string; projectName: string; seconds: number; billableSeconds: number; valueCents: number }
    >();
    const byUserMap = new Map<
      string,
      { userId: string; name: string; seconds: number; billableSeconds: number; valueCents: number }
    >();

    for (const e of entries) {
      const sec = e.durationSec ?? 0;
      totals.seconds += sec;
      if (e.billable) {
        totals.billableSeconds += sec;
        const value = Math.round((sec / 3600) * (e.hourlyRateCents ?? 0));
        totals.valueCents += value;

        const p = byProjectMap.get(e.projectId) ?? {
          projectId: e.projectId,
          projectName: e.project.name,
          seconds: 0,
          billableSeconds: 0,
          valueCents: 0,
        };
        p.seconds += sec;
        p.billableSeconds += sec;
        p.valueCents += value;
        byProjectMap.set(e.projectId, p);

        const u = byUserMap.get(e.userId) ?? {
          userId: e.userId,
          name: e.user.name,
          seconds: 0,
          billableSeconds: 0,
          valueCents: 0,
        };
        u.seconds += sec;
        u.billableSeconds += sec;
        u.valueCents += value;
        byUserMap.set(e.userId, u);
      } else {
        const p = byProjectMap.get(e.projectId) ?? {
          projectId: e.projectId,
          projectName: e.project.name,
          seconds: 0,
          billableSeconds: 0,
          valueCents: 0,
        };
        p.seconds += sec;
        byProjectMap.set(e.projectId, p);
        const u = byUserMap.get(e.userId) ?? {
          userId: e.userId,
          name: e.user.name,
          seconds: 0,
          billableSeconds: 0,
          valueCents: 0,
        };
        u.seconds += sec;
        byUserMap.set(e.userId, u);
      }
    }

    return {
      totals,
      byProject: Array.from(byProjectMap.values()).sort((a, b) => b.seconds - a.seconds),
      byUser: Array.from(byUserMap.values()).sort((a, b) => b.seconds - a.seconds),
    };
  }

  async generateInvoice(userId: string, orgId: string, dto: GenerateInvoiceDto) {
    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, organizationId: orgId },
      select: { id: true, name: true },
    });
    if (!project) throw new NotFoundException("Project not found");

    const where: Record<string, unknown> = {
      organizationId: orgId,
      projectId: dto.projectId,
      invoiceLineItemId: null,
      NOT: { endedAt: null },
    };
    if (!dto.includeNonBillable) where.billable = true;
    if (dto.from || dto.to) {
      where.startedAt = {
        ...(dto.from ? { gte: new Date(dto.from) } : {}),
        ...(dto.to ? { lte: new Date(dto.to) } : {}),
      };
    }

    const entries = await this.prisma.timeEntry.findMany({
      where,
      include: { task: { select: { title: true } } },
      orderBy: { startedAt: "asc" },
    });
    if (entries.length === 0) {
      throw new BadRequestException("No eligible time entries to invoice");
    }

    return this.prisma.$transaction(async (tx) => {
      const last = await tx.invoice.findFirst({
        where: { organizationId: orgId },
        orderBy: { invoiceNumber: "desc" },
        select: { invoiceNumber: true },
      });
      let next = 1;
      if (last) {
        const m = last.invoiceNumber.match(/INV-(\d+)/);
        if (m) next = parseInt(m[1], 10) + 1;
      }
      const invoiceNumber = `INV-${String(next).padStart(4, "0")}`;

      const lineItemsData = entries.map((e) => {
        const hours = (e.durationSec ?? 0) / 3600;
        const total = Math.round(hours * (e.hourlyRateCents ?? 0));
        const dateStr = e.startedAt.toISOString().slice(0, 10);
        const label = e.description ?? e.task?.title ?? "Time entry";
        const rateStr = ((e.hourlyRateCents ?? 0) / 100).toFixed(2);
        const hoursStr = hours.toFixed(2);
        return {
          description: `${label} — ${dateStr} (${hoursStr}h @ $${rateStr}/hr)`,
          quantity: 1,
          unitPrice: total,
        };
      });

      const invoice = await tx.invoice.create({
        data: {
          organizationId: orgId,
          projectId: dto.projectId,
          invoiceNumber,
          status: "draft",
          lineItems: { create: lineItemsData },
        },
        include: { lineItems: true },
      });

      // Link entries 1:1 to line items by index (insertion order matches `entries`).
      for (let i = 0; i < entries.length; i++) {
        await tx.timeEntry.update({
          where: { id: entries[i].id },
          data: { invoiceLineItemId: invoice.lineItems[i].id },
        });
      }

      return { invoiceId: invoice.id };
    });
  }
}
