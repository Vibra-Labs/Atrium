import { describe, expect, it, mock } from "bun:test";
import { MondayDigestService } from "./monday-digest.service";

const NOW = new Date("2026-10-12T08:00:00Z");
const WEEK_AGO = new Date("2026-10-05T08:00:00Z");
const NEXT_WEEK = new Date("2026-10-19T08:00:00Z");

function build(data: { tasks?: unknown[]; taskCount?: number; notes?: unknown[]; noteCount?: number; invoices?: unknown[] } = {}) {
  const prisma = {
    task: {
      findMany: mock(() => Promise.resolve(data.tasks ?? [])),
      count: mock(() => Promise.resolve(data.taskCount ?? (data.tasks ?? []).length)),
    },
    notification: {
      findMany: mock(() => Promise.resolve(data.notes ?? [])),
      count: mock(() => Promise.resolve(data.noteCount ?? (data.notes ?? []).length)),
    },
    invoice: { findMany: mock(() => Promise.resolve(data.invoices ?? [])) },
  };
  return { service: new MondayDigestService(prisma as never), prisma };
}

describe("MondayDigestService.collect", () => {
  it("is empty when nothing is due, nothing happened and nothing is overdue", async () => {
    const digest = await build().service.collect({ userId: "u1", organizationId: "org1" }, NOW);
    expect(digest.isEmpty).toBe(true);
  });

  it("finds open tasks due within the week, including overdue, for this person or nobody", async () => {
    const { service, prisma } = build({
      tasks: [
        { title: "Send proofs", dueDate: new Date("2026-10-09T00:00:00Z"), project: { name: "Living Unlimited" } },
        { title: "Kickoff call", dueDate: new Date("2026-10-14T00:00:00Z"), project: { name: "New Site" } },
      ],
      taskCount: 12,
    });
    const digest = await service.collect({ userId: "u1", organizationId: "org1" }, NOW);

    const where = (prisma.task.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toEqual({
      organizationId: "org1",
      status: { in: ["open", "in_progress"] },
      dueDate: { lte: NEXT_WEEK },
      OR: [{ assigneeId: "u1" }, { assigneeId: null }],
      project: { archivedAt: null },
    });
    expect(digest.tasks).toEqual([
      { title: "Send proofs", projectName: "Living Unlimited", dueDate: new Date("2026-10-09T00:00:00Z"), overdue: true },
      { title: "Kickoff call", projectName: "New Site", dueDate: new Date("2026-10-14T00:00:00Z"), overdue: false },
    ]);
    expect(digest.taskTotal).toBe(12);
    expect(digest.isEmpty).toBe(false);
  });

  it("collects this person's unread notifications from the past week", async () => {
    const { service, prisma } = build({
      notes: [{ title: "New comment on Homepage", message: "Looks great!", link: "/dashboard/projects/p1" }],
    });
    const digest = await service.collect({ userId: "u1", organizationId: "org1" }, NOW);
    const where = (prisma.notification.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toEqual({ userId: "u1", organizationId: "org1", read: false, createdAt: { gte: WEEK_AGO } });
    expect(digest.activity).toEqual([{ title: "New comment on Homepage", message: "Looks great!", link: "/dashboard/projects/p1" }]);
  });

  it("lists invoices that are overdue or sent past their due date", async () => {
    const { service, prisma } = build({
      invoices: [{ invoiceNumber: "INV-0004", dueDate: new Date("2026-10-01T00:00:00Z"), projectId: "p1" }],
    });
    const digest = await service.collect({ userId: "u1", organizationId: "org1" }, NOW);
    const where = (prisma.invoice.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toEqual({
      organizationId: "org1",
      OR: [{ status: "overdue" }, { status: "sent", dueDate: { lt: NOW } }],
    });
    expect(digest.overdueInvoices).toEqual([{ invoiceNumber: "INV-0004", dueDate: new Date("2026-10-01T00:00:00Z"), projectId: "p1" }]);
  });
});
