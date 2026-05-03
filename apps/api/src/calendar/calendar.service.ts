import { BadRequestException, Injectable } from "@nestjs/common";
import { CALENDAR_EVENT_TYPES, type CalendarEvent } from "@atrium/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CalendarQueryDto } from "./calendar.dto";

export type { CalendarEvent };

const VALID_TYPES = new Set<string>(CALENDAR_EVENT_TYPES);

@Injectable()
export class CalendarService {
  constructor(private prisma: PrismaService) {}

  async list(orgId: string, query: CalendarQueryDto): Promise<CalendarEvent[]> {
    const from = new Date(query.from);
    // `to` is inclusive: a date-only string parses to 00:00Z, which would
    // exclude any event timestamped later that day. Extend to end-of-day.
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException("Invalid date format");
    }
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException("`to` must be after `from`");
    }
    const days = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    if (days > 366) {
      throw new BadRequestException("Window cannot exceed 366 days");
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) {
      to.setUTCHours(23, 59, 59, 999);
    }

    const requestedTypes = query.type
      ? new Set(query.type.split(",").map((s) => s.trim()).filter((s) => VALID_TYPES.has(s)))
      : VALID_TYPES;

    const wantTasks = requestedTypes.has("task");
    const wantProjectStart = requestedTypes.has("project_start");
    const wantProjectEnd = requestedTypes.has("project_end");
    const wantInvoices = requestedTypes.has("invoice_due");

    const [tasks, projects, invoices] = await Promise.all([
      wantTasks
        ? this.prisma.task.findMany({
            where: {
              organizationId: orgId,
              ...(query.projectId ? { projectId: query.projectId } : {}),
              dueDate: { gte: from, lte: to },
            },
            select: {
              id: true,
              title: true,
              status: true,
              dueDate: true,
              projectId: true,
              project: { select: { name: true } },
              assigneeId: true,
              assignee: { select: { name: true } },
            },
          })
        : Promise.resolve([] as Array<{
            id: string; title: string; status: string; dueDate: Date | null;
            projectId: string; project: { name: string };
            assigneeId: string | null; assignee: { name: string } | null;
          }>),
      wantProjectStart || wantProjectEnd
        ? this.prisma.project.findMany({
            where: {
              organizationId: orgId,
              ...(query.projectId ? { id: query.projectId } : {}),
              OR: [
                { startDate: { gte: from, lte: to } },
                { endDate: { gte: from, lte: to } },
              ],
            },
            select: { id: true, name: true, startDate: true, endDate: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string; startDate: Date | null; endDate: Date | null }>),
      wantInvoices
        ? this.prisma.invoice.findMany({
            where: {
              organizationId: orgId,
              ...(query.projectId ? { projectId: query.projectId } : {}),
              dueDate: { gte: from, lte: to },
            },
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              dueDate: true,
              amount: true,
              projectId: true,
              project: { select: { name: true } },
              lineItems: { select: { quantity: true, unitPrice: true } },
            },
          })
        : Promise.resolve([] as Array<{
            id: string; invoiceNumber: string; status: string; dueDate: Date | null;
            amount: number | null; projectId: string | null;
            project: { name: string } | null;
            lineItems: Array<{ quantity: number; unitPrice: number }>;
          }>),
    ]);

    const events: CalendarEvent[] = [];

    for (const t of tasks) {
      if (!t.dueDate) continue;
      events.push({
        type: "task",
        id: t.id,
        date: t.dueDate.toISOString().slice(0, 10),
        title: t.title,
        status: t.status,
        projectId: t.projectId,
        projectName: t.project.name,
        assigneeId: t.assigneeId,
        assigneeName: t.assignee?.name ?? null,
      });
    }

    for (const p of projects) {
      if (wantProjectStart && p.startDate && p.startDate >= from && p.startDate <= to) {
        events.push({
          type: "project_start",
          id: p.id,
          date: p.startDate.toISOString().slice(0, 10),
          title: p.name,
          projectId: p.id,
          projectName: p.name,
        });
      }
      if (wantProjectEnd && p.endDate && p.endDate >= from && p.endDate <= to) {
        events.push({
          type: "project_end",
          id: p.id,
          date: p.endDate.toISOString().slice(0, 10),
          title: p.name,
          projectId: p.id,
          projectName: p.name,
        });
      }
    }

    for (const inv of invoices) {
      if (!inv.dueDate) continue;
      const computed = inv.lineItems.reduce((s, li) => s + li.unitPrice * li.quantity, 0);
      events.push({
        type: "invoice_due",
        id: inv.id,
        date: inv.dueDate.toISOString().slice(0, 10),
        title: inv.invoiceNumber,
        status: inv.status,
        projectId: inv.projectId,
        projectName: inv.project?.name ?? null,
        amountCents: inv.amount ?? computed,
      });
    }

    events.sort((a, b) => a.date.localeCompare(b.date));
    return events;
  }
}
