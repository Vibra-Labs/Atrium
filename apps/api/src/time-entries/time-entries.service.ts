import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from "@nestjs/common";
import type { TimeEntry } from "@atrium/database";
import { PrismaService } from "../prisma/prisma.service";
import {
  StartTimerDto,
  CreateManualEntryDto,
  UpdateTimeEntryDto,
  TimeEntryListQueryDto,
  GenerateInvoiceDto,
} from "./time-entries.dto";

// Hard upper bound on rows returned by the unbounded export path. The
// paginated `list()` cap remains at 200; this cap only applies to the
// CSV export and exists to keep a malicious or buggy caller from
// requesting a runaway result set.
const EXPORT_MAX_ROWS = 50_000;

function isP2002(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

// Roles that are allowed to see hourly rate / monetary value data.
const RATE_VISIBLE_ROLES: ReadonlySet<string> = new Set(["owner", "admin"]);
function canSeeRates(role: string | undefined): boolean {
  return role !== undefined && RATE_VISIBLE_ROLES.has(role);
}

export type RunningEntry = {
  id: string;
  organizationId: string;
  projectId: string;
  taskId: string | null;
  userId: string;
  description: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  billable: boolean;
  hourlyRateCents: number | null;
  invoiceLineItemId: string | null;
  createdAt: Date;
  updatedAt: Date;
  project: { id: string; name: string };
  task: { id: string; title: string } | null;
} | null;

export type TimeEntryListItem = Omit<TimeEntry, "hourlyRateCents"> & {
  hourlyRateCents?: number | null;
  project: { id: string; name: string };
  task: { id: string; title: string } | null;
  user: { id: string; name: string; email: string };
};

export type TimeEntryListResponse = {
  data: TimeEntryListItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
};

export type TimeEntryExportResponse = {
  data: TimeEntryListItem[];
};

export type ReportProjectBucket = {
  projectId: string;
  projectName: string;
  seconds: number;
  billableSeconds: number;
  valueCents: number;
};

export type ReportUserBucket = {
  userId: string;
  name: string;
  seconds: number;
  billableSeconds: number;
  valueCents: number;
};

export type TimeReport = {
  totals: { seconds: number; billableSeconds: number; valueCents: number };
  byProject: ReportProjectBucket[];
  byUser: ReportUserBucket[];
};

export type GenerateInvoiceResult = { invoiceId: string };

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

  async start(userId: string, orgId: string, dto: StartTimerDto): Promise<TimeEntry> {
    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, organizationId: orgId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException("Project not found");

    if (dto.taskId) {
      const task = await this.prisma.task.findFirst({
        where: {
          id: dto.taskId,
          projectId: dto.projectId,
          project: { organizationId: orgId },
        },
        select: { id: true },
      });
      if (!task) throw new NotFoundException("Task not found");
    }

    const rate = await this.resolveRate(orgId, userId, dto.projectId);

    // The transaction first closes out any existing running entry, then
    // creates the new one. Two concurrent calls can both observe `running`
    // as null and proceed to create, so a partial unique index on
    // ("organizationId", "userId") WHERE "endedAt" IS NULL is applied at
    // the database level (see migrate-time-entry-running-unique.ts). We
    // translate the resulting P2002 into a 409 ConflictException for the
    // caller — typically a double-click or two browser tabs racing.
    try {
      return await this.prisma.$transaction(async (tx) => {
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
    } catch (err) {
      if (isP2002(err)) {
        throw new ConflictException("A timer is already running for this user");
      }
      throw err;
    }
  }

  async stop(userId: string, orgId: string): Promise<TimeEntry> {
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

  async getRunning(userId: string, orgId: string): Promise<RunningEntry> {
    return this.prisma.timeEntry.findFirst({
      where: { userId, organizationId: orgId, endedAt: null },
      include: { project: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } },
    });
  }

  async create(userId: string, orgId: string, dto: CreateManualEntryDto): Promise<TimeEntry> {
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
        where: {
          id: dto.taskId,
          projectId: dto.projectId,
          project: { organizationId: orgId },
        },
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

  private async findOwnEntryOrThrow(id: string, userId: string, orgId: string): Promise<TimeEntry> {
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

  async update(id: string, userId: string, orgId: string, dto: UpdateTimeEntryDto): Promise<TimeEntry> {
    const entry = await this.findOwnEntryOrThrow(id, userId, orgId);

    const start = dto.startedAt ? new Date(dto.startedAt) : entry.startedAt;
    const end = dto.endedAt ? new Date(dto.endedAt) : entry.endedAt;
    if (end && end.getTime() <= start.getTime()) {
      throw new BadRequestException("endedAt must be after startedAt");
    }
    const durationSec = end ? Math.round((end.getTime() - start.getTime()) / 1000) : entry.durationSec;

    // If taskId changes, verify it belongs to the entry's project (and that
    // project belongs to the actor's org). Without this, a caller could PATCH
    // a taskId from another project — the FK passes but reports/CSV go wrong.
    const nextTaskId = dto.taskId === undefined ? entry.taskId : dto.taskId;
    if (nextTaskId !== entry.taskId && nextTaskId !== null) {
      const task = await this.prisma.task.findFirst({
        where: {
          id: nextTaskId,
          projectId: entry.projectId,
          project: { organizationId: orgId },
        },
        select: { id: true },
      });
      if (!task) throw new NotFoundException("Task not found");
    }

    return this.prisma.timeEntry.update({
      where: { id },
      data: {
        description:
          "description" in dto ? dto.description ?? null : entry.description,
        startedAt: start,
        endedAt: end,
        durationSec,
        billable: dto.billable ?? entry.billable,
        taskId: nextTaskId,
      },
    });
  }

  async delete(id: string, userId: string, orgId: string): Promise<void> {
    await this.findOwnEntryOrThrow(id, userId, orgId);
    await this.prisma.timeEntry.delete({ where: { id } });
  }

  private buildListWhere(orgId: string, query: TimeEntryListQueryDto): Record<string, unknown> {
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
    return where;
  }

  private stripRate(entry: TimeEntryListItem & { hourlyRateCents: number | null }): TimeEntryListItem {
    const { hourlyRateCents: _omit, ...rest } = entry;
    void _omit;
    return rest;
  }

  async list(orgId: string, query: TimeEntryListQueryDto, role?: string): Promise<TimeEntryListResponse> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const where = this.buildListWhere(orgId, query);

    const [rows, total] = await Promise.all([
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

    const data: TimeEntryListItem[] = canSeeRates(role)
      ? rows
      : rows.map((r) => this.stripRate(r));

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  // Unbounded read path for CSV export. Applies the same filters as list()
  // but skips pagination — callers asking for "a year of data" should not
  // be silently truncated at 200 rows. A hard cap of EXPORT_MAX_ROWS still
  // applies so a runaway request can't OOM the API.
  async listForExport(orgId: string, query: TimeEntryListQueryDto, role?: string): Promise<TimeEntryExportResponse> {
    const where = this.buildListWhere(orgId, query);
    const rows = await this.prisma.timeEntry.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { startedAt: "desc" },
      take: EXPORT_MAX_ROWS,
    });
    const data: TimeEntryListItem[] = canSeeRates(role)
      ? rows
      : rows.map((r) => this.stripRate(r));
    return { data };
  }

  async report(orgId: string, query: TimeEntryListQueryDto, role?: string): Promise<TimeReport> {
    const where: Record<string, unknown> = { organizationId: orgId };
    if (query.projectId) where.projectId = query.projectId;
    if (query.userId) where.userId = query.userId;
    if (query.from || query.to) {
      where.startedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    // Only consider finished entries (durationSec is set).
    const reportWhere = { ...where, NOT: { durationSec: null } };

    // Aggregate at the database. We group by (projectId, userId, billable,
    // hourlyRateCents) so we can compute value cents per bucket without
    // pulling full rows. Two passes — one DB groupBy + a final fold — keeps
    // memory bounded regardless of row count.
    const groups = await this.prisma.timeEntry.groupBy({
      by: ["projectId", "userId", "billable", "hourlyRateCents"],
      where: reportWhere,
      _sum: { durationSec: true },
    });

    const projectIds = new Set<string>();
    const userIds = new Set<string>();
    for (const g of groups) {
      projectIds.add(g.projectId);
      userIds.add(g.userId);
    }

    const [projects, users] = await Promise.all([
      projectIds.size > 0
        ? this.prisma.project.findMany({
            where: { id: { in: Array.from(projectIds) } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      userIds.size > 0
        ? this.prisma.user.findMany({
            where: { id: { in: Array.from(userIds) } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);
    const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
    const userNameById = new Map(users.map((u) => [u.id, u.name]));

    const totals = { seconds: 0, billableSeconds: 0, valueCents: 0 };
    const byProjectMap = new Map<string, ReportProjectBucket>();
    const byUserMap = new Map<string, ReportUserBucket>();

    for (const g of groups) {
      const sec = g._sum.durationSec ?? 0;
      totals.seconds += sec;

      const p = byProjectMap.get(g.projectId) ?? {
        projectId: g.projectId,
        projectName: projectNameById.get(g.projectId) ?? "",
        seconds: 0,
        billableSeconds: 0,
        valueCents: 0,
      };
      const u = byUserMap.get(g.userId) ?? {
        userId: g.userId,
        name: userNameById.get(g.userId) ?? "",
        seconds: 0,
        billableSeconds: 0,
        valueCents: 0,
      };

      p.seconds += sec;
      u.seconds += sec;

      if (g.billable) {
        const value = Math.round((sec / 3600) * (g.hourlyRateCents ?? 0));
        totals.billableSeconds += sec;
        totals.valueCents += value;
        p.billableSeconds += sec;
        p.valueCents += value;
        u.billableSeconds += sec;
        u.valueCents += value;
      }

      byProjectMap.set(g.projectId, p);
      byUserMap.set(g.userId, u);
    }

    const report: TimeReport = {
      totals,
      byProject: Array.from(byProjectMap.values()).sort((a, b) => b.seconds - a.seconds),
      byUser: Array.from(byUserMap.values()).sort((a, b) => b.seconds - a.seconds),
    };

    // Hide monetary totals from non-rate-visible roles (member). durationSec
    // is still returned so members can see hours; valueCents is zeroed.
    if (!canSeeRates(role)) {
      report.totals.valueCents = 0;
      for (const b of report.byProject) b.valueCents = 0;
      for (const b of report.byUser) b.valueCents = 0;
    }

    return report;
  }

  async generateInvoice(userId: string, orgId: string, dto: GenerateInvoiceDto): Promise<GenerateInvoiceResult> {
    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, organizationId: orgId },
      select: { id: true, name: true },
    });
    if (!project) throw new NotFoundException("Project not found");

    const where: Record<string, unknown> = {
      organizationId: orgId,
      projectId: dto.projectId,
      invoiceLineItemId: null,
      endedAt: { not: null },
      durationSec: { not: null },
    };
    if (!dto.includeNonBillable) where.billable = true;
    if (dto.from || dto.to) {
      // Date-only inputs become inclusive whole days. `to` is bumped to the
      // start of the next day (exclusive) so an entry started any time on
      // the picked day is still included.
      const toDate = dto.to ? new Date(dto.to) : null;
      if (toDate) toDate.setUTCDate(toDate.getUTCDate() + 1);
      where.startedAt = {
        ...(dto.from ? { gte: new Date(dto.from) } : {}),
        ...(toDate ? { lt: toDate } : {}),
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

    // Backfill rates onto entries that were created before any rate was set.
    // The frozen-rate snapshot only matters when a rate existed at creation;
    // null means we have nothing to preserve, so applying the current
    // project/member rate is the most useful behavior and brings the entry
    // row in line with what will appear on the invoice.
    for (const e of entries) {
      if (e.hourlyRateCents != null && e.hourlyRateCents > 0) continue;
      const resolved = await this.resolveRate(orgId, e.userId, e.projectId);
      if (resolved != null && resolved > 0) {
        e.hourlyRateCents = resolved;
        await this.prisma.timeEntry.update({
          where: { id: e.id },
          data: { hourlyRateCents: resolved },
        });
      }
    }

    const missingRate = entries.find(
      (e) => e.hourlyRateCents === null || e.hourlyRateCents === 0,
    );
    if (missingRate) {
      throw new BadRequestException(
        "One or more entries have no hourly rate. Set a project or member rate first — entries already created without a rate will pick it up automatically once one is set.",
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Lex-safe ordering: createdAt is monotonic; invoiceNumber strings sort
      // wrong once they grow past 9999 (e.g. "INV-9999" > "INV-10000").
      const last = await tx.invoice.findFirst({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        select: { invoiceNumber: true },
      });
      let next = 1;
      if (last) {
        const m = last.invoiceNumber.match(/INV-(\d+)/);
        if (m) next = parseInt(m[1], 10) + 1;
      }
      const invoiceNumber = `INV-${String(next).padStart(4, "0")}`;

      const invoice = await tx.invoice.create({
        data: {
          organizationId: orgId,
          projectId: dto.projectId,
          invoiceNumber,
          status: "draft",
        },
      });

      if (dto.mergeEntries) {
        // Group by hourly rate; one line item per rate. Merging implies
        // all merged entries share the same rate, so we compute unitPrice
        // once from the summed seconds — a single rounding step. This
        // matches the label math exactly (e.g. "12.50h @ $75.00/hr" =>
        // $937.50, not the $937.49 you'd get from summing per-entry
        // rounded cent amounts).
        const byRate = new Map<
          number,
          { entryIds: string[]; totalSec: number }
        >();
        for (const e of entries) {
          const rate = e.hourlyRateCents as number;
          const g = byRate.get(rate) ?? { entryIds: [], totalSec: 0 };
          g.entryIds.push(e.id);
          g.totalSec += e.durationSec ?? 0;
          byRate.set(rate, g);
        }

        for (const [rate, g] of byRate) {
          const hours = g.totalSec / 3600;
          const total = Math.round(hours * rate);
          const rateStr = (rate / 100).toFixed(2);
          const hoursStr = hours.toFixed(2);
          const label = `${project.name} — ${hoursStr}h @ $${rateStr}/hr (${g.entryIds.length} entries)`;
          const lineItem = await tx.invoiceLineItem.create({
            data: {
              invoiceId: invoice.id,
              description: label,
              quantity: 1,
              unitPrice: total,
            },
          });
          await tx.timeEntry.updateMany({
            where: { id: { in: g.entryIds } },
            data: { invoiceLineItemId: lineItem.id },
          });
        }
      } else {
        for (const e of entries) {
          const rate = e.hourlyRateCents as number;
          const hours = (e.durationSec ?? 0) / 3600;
          const total = Math.round(hours * rate);
          const dateStr = e.startedAt.toISOString().slice(0, 10);
          const label = e.description ?? e.task?.title ?? "Time entry";
          const rateStr = (rate / 100).toFixed(2);
          const hoursStr = hours.toFixed(2);
          const lineItem = await tx.invoiceLineItem.create({
            data: {
              invoiceId: invoice.id,
              description: `${label} — ${dateStr} (${hoursStr}h @ $${rateStr}/hr)`,
              quantity: 1,
              unitPrice: total,
            },
          });
          await tx.timeEntry.update({
            where: { id: e.id },
            data: { invoiceLineItemId: lineItem.id },
          });
        }
      }

      return { invoiceId: invoice.id };
    });
  }
}
