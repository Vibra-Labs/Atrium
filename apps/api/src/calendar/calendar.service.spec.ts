import { describe, expect, it, mock } from "bun:test";
import { CalendarService } from "./calendar.service";

function build() {
  const prisma = {
    task: { findMany: mock(() => Promise.resolve([])) },
    project: { findMany: mock(() => Promise.resolve([])) },
    invoice: { findMany: mock(() => Promise.resolve([])) },
  };
  return { prisma, service: new CalendarService(prisma as never) };
}

type Where = Record<string, unknown>;
const whereOf = (m: { mock: { calls: unknown[][] } }): Where => (m.mock.calls[0][0] as { where: Where }).where;

describe("CalendarService.list activeOnly", () => {
  const range = { from: "2026-10-28", to: "2026-11-03" };

  it("leaves the full calendar unfiltered by default", async () => {
    const { prisma, service } = build();
    await service.list("org-1", range);
    expect(whereOf(prisma.task.findMany)).not.toHaveProperty("project");
    expect(whereOf(prisma.project.findMany)).not.toHaveProperty("archivedAt");
    expect(whereOf(prisma.invoice.findMany)).not.toHaveProperty("OR");
  });

  it("skips archived projects and finished project deadlines when asked", async () => {
    const { prisma, service } = build();
    await service.list("org-1", { ...range, activeOnly: "true" });
    expect(whereOf(prisma.task.findMany).project).toEqual({ archivedAt: null });
    expect(whereOf(prisma.project.findMany)).toEqual(
      expect.objectContaining({ archivedAt: null, status: { notIn: ["completed", "cancelled"] } }),
    );
    expect(whereOf(prisma.invoice.findMany).OR).toEqual([{ projectId: null }, { project: { archivedAt: null } }]);
  });
});
