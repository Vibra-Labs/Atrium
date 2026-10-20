import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { WEEK_MS } from "../common/helpers/local-time";

const MAX_TASKS = 10;
const MAX_ACTIVITY = 8;
const MAX_FOLLOW_UPS = 10;

export interface DigestTask {
  title: string;
  projectName: string;
  dueDate: Date | null;
  overdue: boolean;
}

export interface DigestActivity {
  title: string;
  message: string;
  link: string | null;
}

export interface MondayDigest {
  tasks: DigestTask[];
  taskTotal: number;
  activity: DigestActivity[];
  activityTotal: number;
  overdueInvoices: { invoiceNumber: string; dueDate: Date | null; projectId: string | null }[];
  followUps: { name: string; contactId: string; dueAt: Date; overdue: boolean }[];
  followUpTotal: number;
  isEmpty: boolean;
}

/** What an owner/admin should look at as their week starts. */
@Injectable()
export class MondayDigestService {
  constructor(private prisma: PrismaService) {}

  async collect(member: { userId: string; organizationId: string }, now: Date): Promise<MondayDigest> {
    const { userId, organizationId } = member;

    // Open work due by the end of the coming week (overdue included), theirs or nobody's.
    const taskWhere = {
      organizationId,
      status: { in: ["open", "in_progress"] },
      dueDate: { lte: new Date(now.getTime() + WEEK_MS) },
      OR: [{ assigneeId: userId }, { assigneeId: null }],
      project: { archivedAt: null },
    };
    // Unread notifications cover what clients did: comments, requests, signatures, payments.
    const activityWhere = {
      userId,
      organizationId,
      read: false,
      createdAt: { gte: new Date(now.getTime() - WEEK_MS) },
    };

    // Contacts are shared across the workspace, so follow-ups are org-wide.
    const followUpWhere = { organizationId, followUpAt: { lte: new Date(now.getTime() + WEEK_MS) } };

    const [tasks, taskTotal, activity, activityTotal, overdueInvoices, followUps, followUpTotal] = await Promise.all([
      this.prisma.task.findMany({
        where: taskWhere,
        select: { title: true, dueDate: true, project: { select: { name: true } } },
        orderBy: { dueDate: "asc" },
        take: MAX_TASKS,
      }),
      this.prisma.task.count({ where: taskWhere }),
      this.prisma.notification.findMany({
        where: activityWhere,
        select: { title: true, message: true, link: true },
        orderBy: { createdAt: "desc" },
        take: MAX_ACTIVITY,
      }),
      this.prisma.notification.count({ where: activityWhere }),
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          OR: [{ status: "overdue" }, { status: "sent", dueDate: { lt: now } }],
        },
        select: { invoiceNumber: true, dueDate: true, projectId: true },
        orderBy: { dueDate: "asc" },
      }),
      this.prisma.contact.findMany({
        where: followUpWhere,
        select: { id: true, name: true, followUpAt: true },
        orderBy: { followUpAt: "asc" },
        take: MAX_FOLLOW_UPS,
      }),
      this.prisma.contact.count({ where: followUpWhere }),
    ]);

    return {
      tasks: tasks.map((t) => ({
        title: t.title,
        projectName: t.project.name,
        dueDate: t.dueDate,
        overdue: t.dueDate !== null && t.dueDate < now,
      })),
      taskTotal,
      activity,
      activityTotal,
      overdueInvoices,
      followUps: followUps.flatMap((c) =>
        c.followUpAt ? [{ name: c.name, contactId: c.id, dueAt: c.followUpAt, overdue: c.followUpAt < now }] : [],
      ),
      followUpTotal,
      isEmpty: taskTotal === 0 && activityTotal === 0 && overdueInvoices.length === 0 && followUpTotal === 0,
    };
  }
}
