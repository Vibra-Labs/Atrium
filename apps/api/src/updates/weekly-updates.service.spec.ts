import { describe, expect, it, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { WeeklyUpdatesService } from "./weekly-updates.service";

const NOW = new Date("2026-10-09T09:00:00Z");
const WEEK_AGO = new Date("2026-10-02T09:00:00Z");

function build(overrides: { project?: unknown; projects?: unknown[] } = {}) {
  const prisma = {
    project: {
      findFirst: mock(() =>
        Promise.resolve(overrides.project === undefined ? { id: "p1", name: "Living Unlimited" } : overrides.project),
      ),
      findMany: mock(() => Promise.resolve(overrides.projects ?? [])),
    },
    task: {
      findMany: mock(({ where }: { where: { status: unknown } }) =>
        Promise.resolve(
          where.status === "done"
            ? [{ title: "Homepage design" }]
            : [{ title: "About page" }],
        ),
      ),
    },
    file: { findMany: mock(() => Promise.resolve([{ filename: "homepage-v2.pdf" }])) },
    timeEntry: {
      aggregate: mock(() => Promise.resolve({ _sum: { durationSec: 5400 } })),
    },
  };
  return { service: new WeeklyUpdatesService(prisma as never), prisma };
}

describe("WeeklyUpdatesService.getDraft", () => {
  it("builds a draft from the last 7 days of the project", async () => {
    const { service, prisma } = build();
    const draft = await service.getDraft("p1", "org1", NOW);

    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: "p1", organizationId: "org1" },
      select: { id: true, name: true },
    });
    const doneQuery = prisma.task.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }];
    expect(doneQuery[0].where).toMatchObject({ projectId: "p1", status: "done", updatedAt: { gte: WEEK_AGO } });

    expect(draft.content).toContain("- Homepage design");
    expect(draft.content).toContain("- homepage-v2.pdf");
    expect(draft.content).toContain("- About page");
    // Hours are for the owner only; they never go into the client-facing text.
    expect(draft.stats).toEqual({ completedTasks: 1, newFiles: 1, hoursLogged: 1.5 });
    expect(draft.content).not.toContain("1.5");
  });

  it("404s for a project outside the workspace", async () => {
    const { service } = build({ project: null });
    await expect(service.getDraft("p1", "org1", NOW)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("WeeklyUpdatesService.getDue", () => {
  it("lists client projects with no update in 7 days, longest-waiting first", async () => {
    const { service, prisma } = build({
      projects: [
        { id: "a", name: "Recent", updates: [{ createdAt: new Date("2026-10-08T00:00:00Z") }], _count: { clients: 1 } },
        { id: "b", name: "Stale", updates: [{ createdAt: new Date("2026-09-20T00:00:00Z") }], _count: { clients: 2 } },
        { id: "c", name: "Never", updates: [], _count: { clients: 1 } },
      ],
    });
    const due = await service.getDue("org1", NOW);

    const query = prisma.project.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }];
    expect(query[0].where).toMatchObject({
      organizationId: "org1",
      archivedAt: null,
      status: { not: "completed" },
      clients: { some: {} },
    });
    expect(due.map((p) => p.projectId)).toEqual(["c", "b"]);
    expect(due[1]).toEqual({
      projectId: "b",
      projectName: "Stale",
      lastUpdateAt: new Date("2026-09-20T00:00:00Z"),
      clientCount: 2,
    });
  });
});

