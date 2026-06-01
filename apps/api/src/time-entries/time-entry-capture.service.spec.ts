import { describe, expect, it, mock } from "bun:test";
import { TimeEntryCaptureService } from "./time-entry-capture.service";

function makeService(running: { id: string; userId: string } | null) {
  const prisma = {
    timeEntry: {
      findFirst: mock(async () => running),
    },
    timeEntryLog: {
      create: mock(async (args: unknown) => args),
    },
    pendingTimeCapture: {
      create: mock(async (args: unknown) => args),
    },
  };
  const logger = { warn: mock(() => undefined) };
  const service = new TimeEntryCaptureService(prisma as never, logger as never);
  return { service, prisma, logger };
}

const input = {
  orgId: "org_1",
  projectId: "proj_1",
  taskId: "task_1",
  actorType: "agent" as const,
  actorName: "API key pxl_1234",
  taskTitle: "Wire invoices",
};

describe("TimeEntryCaptureService", () => {
  it("writes a task_done log when a timer is running on the project", async () => {
    const { service, prisma } = makeService({ id: "entry_1", userId: "user_1" });

    await service.captureTaskCompletion(input);

    expect(prisma.timeEntry.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org_1", projectId: "proj_1", endedAt: null },
      select: { id: true, userId: true },
      orderBy: { startedAt: "desc" },
    });
    expect(prisma.timeEntryLog.create).toHaveBeenCalledWith({
      data: {
        timeEntryId: "entry_1",
        organizationId: "org_1",
        userId: "user_1",
        kind: "task_done",
        text: "Completed: Wire invoices",
        taskId: "task_1",
        actorType: "agent",
      },
    });
    expect(prisma.pendingTimeCapture.create).not.toHaveBeenCalled();
  });

  it("creates a pending capture when no timer is running", async () => {
    const { service, prisma } = makeService(null);

    await service.captureTaskCompletion(input);

    expect(prisma.timeEntryLog.create).not.toHaveBeenCalled();
    expect(prisma.pendingTimeCapture.create).toHaveBeenCalledWith({
      data: {
        organizationId: "org_1",
        projectId: "proj_1",
        taskId: "task_1",
        kind: "task_done",
        label: "API key pxl_1234 completed “Wire invoices”",
        completedByType: "agent",
        completedByName: "API key pxl_1234",
      },
    });
  });

  it("swallows capture failures so task completion is best-effort", async () => {
    const prisma = {
      timeEntry: { findFirst: mock(async () => { throw new Error("db unavailable"); }) },
      timeEntryLog: { create: mock(async () => undefined) },
      pendingTimeCapture: { create: mock(async () => undefined) },
    };
    const logger = { warn: mock(() => undefined) };
    const service = new TimeEntryCaptureService(prisma as never, logger as never);

    await expect(service.captureTaskCompletion(input)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
