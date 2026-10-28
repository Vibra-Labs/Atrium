import { describe, expect, it, mock, beforeEach } from "bun:test";
import { ProjectsService } from "./projects.service";
import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";

interface PrismaArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

const mockPrisma = {
  project: {
    findMany: mock(() => Promise.resolve([])),
    findFirst: mock(() => Promise.resolve(null)),
    count: mock(() => Promise.resolve(0)),
    findUnique: mock((args: PrismaArgs) =>
      Promise.resolve({ id: args.where?.id, name: "Test", organizationId: "org-1", clients: [] }),
    ),
    create: mock((args: PrismaArgs) =>
      Promise.resolve({ id: "new-id", ...args.data, clients: [] }),
    ),
    update: mock((args: PrismaArgs) =>
      Promise.resolve({ id: args.where?.id, ...args.data, clients: [] }),
    ),
    updateMany: mock(() => Promise.resolve({ count: 1 })),
    delete: mock((args: PrismaArgs) => Promise.resolve({ id: args.where?.id })),
    deleteMany: mock(() => Promise.resolve({ count: 1 })),
  },
  projectClient: {
    findMany: mock(() => Promise.resolve([] as { userId: string }[])),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
    createMany: mock(() => Promise.resolve({ count: 0 })),
  },
  projectLabel: {
    createMany: mock(() => Promise.resolve({ count: 0 })),
  },
  document: {
    count: mock(() => Promise.resolve(0)),
  },
  task: {
    groupBy: mock(() => Promise.resolve([])),
    createMany: mock(() => Promise.resolve({ count: 0 })),
  },
  taskLabel: {
    createMany: mock(() => Promise.resolve({ count: 0 })),
  },
  decisionOption: {
    createMany: mock(() => Promise.resolve({ count: 0 })),
  },
  projectStatus: {
    findMany: mock(() => Promise.resolve([])),
    findFirst: mock(() => Promise.resolve(null)),
  },
  member: {
    count: mock(() => Promise.resolve(2)),
  },
  organization: {
    findUnique: mock(() => Promise.resolve({ name: "Acme", members: [] })),
  },
  $queryRaw: mock(() => Promise.resolve([] as unknown[])),
  $transaction: mock((arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof mockPrisma) => Promise<unknown>)(mockPrisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  }),
};

const mockContactSync = {
  linkProjectClients: mock(() => Promise.resolve()),
  endProjectClients: mock(() => Promise.resolve()),
};

describe("ProjectsService", () => {
  let service: ProjectsService;

  beforeEach(() => {
    service = new ProjectsService(mockPrisma as unknown as PrismaService, mockContactSync as never);
    mockContactSync.linkProjectClients.mockClear();
    mockContactSync.endProjectClients.mockClear();
    // Reset mocks
    Object.values(mockPrisma.project).forEach((m) => {
      if (typeof m === "function" && "mockClear" in m) {
        (m as ReturnType<typeof mock>).mockClear?.();
      }
    });
    mockPrisma.projectClient.deleteMany.mockClear();
    mockPrisma.projectClient.createMany.mockClear();
    mockPrisma.projectLabel.createMany.mockClear();
    mockPrisma.task.createMany.mockClear();
    mockPrisma.taskLabel.createMany.mockClear();
    mockPrisma.decisionOption.createMany.mockClear();
    mockPrisma.$transaction.mockClear();
    mockPrisma.$queryRaw.mockClear();
  });

  it("findAll returns projects for organization", async () => {
    const projects = [
      { id: "1", name: "Test", organizationId: "org-1", clients: [] },
    ];
    mockPrisma.project.findMany.mockReturnValue(Promise.resolve(projects));
    mockPrisma.project.count = mock(() => Promise.resolve(1));

    const result = await service.findAll("org-1", {});
    expect(result.data).toEqual([{ ...projects[0], taskCount: 0, completedTaskCount: 0 }]);
    expect(result.meta.total).toBe(1);
    expect(result.meta.page).toBe(1);
  });

  it("findAll counts task progress in one query instead of loading every task", async () => {
    mockPrisma.project.findMany.mockReturnValue(Promise.resolve([{ id: "p1", clients: [] }]));
    mockPrisma.project.count = mock(() => Promise.resolve(1));
    mockPrisma.task.groupBy.mockReturnValueOnce(
      Promise.resolve([
        { projectId: "p1", status: "done", _count: { _all: 3 }, _max: { updatedAt: null } },
        { projectId: "p1", status: "todo", _count: { _all: 1 }, _max: { updatedAt: null } },
      ]) as never,
    );

    const result = await service.findAll("org-1", {});

    const args = mockPrisma.project.findMany.mock.calls.at(-1)?.[0] as { include: Record<string, unknown> };
    expect(args.include).not.toHaveProperty("tasks");
    expect(result.data[0]).toEqual(expect.objectContaining({ taskCount: 4, completedTaskCount: 3 }));
  });

  it("findByClient returns a pendingApprovals count per project", async () => {
    mockPrisma.project.findMany.mockReturnValue(
      Promise.resolve([{ id: "p1", name: "Site", _count: { documents: 2 }, updates: [], files: [] }]),
    );
    mockPrisma.project.count = mock(() => Promise.resolve(1));
    const res = await service.findByClient("client-1", "org-1", {});
    expect(res.data[0]).toEqual(expect.objectContaining({ id: "p1", pendingApprovals: 2 }));
    expect(res.data[0]).not.toHaveProperty("_count");
  });

  it("findByClient limits a client to their own projects", async () => {
    mockPrisma.project.findMany.mockReturnValue(Promise.resolve([]));
    mockPrisma.project.count = mock(() => Promise.resolve(0));
    await service.findByClient("client-1", "org-1", {});
    const args = mockPrisma.project.findMany.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
    expect(args.where.clients).toEqual({ some: { userId: "client-1" } });
  });

  it("findByClient shows an owner or admin every project in the workspace", async () => {
    mockPrisma.project.findMany.mockReturnValue(Promise.resolve([]));
    mockPrisma.project.count = mock(() => Promise.resolve(0));
    await service.findByClient("owner-1", "org-1", {}, true);
    const args = mockPrisma.project.findMany.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
    expect(args.where).not.toHaveProperty("clients");
    expect(args.where.organizationId).toBe("org-1");
  });

  it("findOneByClient lets an owner or admin open a project with no client", async () => {
    mockPrisma.project.findFirst.mockReturnValue(Promise.resolve({ id: "p1", files: [] }));
    await service.findOneByClient("p1", "owner-1", "org-1", true);
    const args = mockPrisma.project.findFirst.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
    expect(args.where).not.toHaveProperty("clients");
    expect(args.where.organizationId).toBe("org-1");
  });

  it("findOneByClient names the project lead without exposing the owner's email", async () => {
    mockPrisma.project.findFirst.mockReturnValue(Promise.resolve({ id: "p1", files: [] }));
    await service.findOneByClient("p1", "user-client", "org-1");
    const args = mockPrisma.organization.findUnique.mock.calls.at(-1)?.[0] as {
      select: { members: { select: { user: { select: Record<string, boolean> } } } };
    };
    expect(args.select.members.select.user.select).toEqual({ id: true, name: true });
  });

  it("getStats adds deliverables to review and documents to sign into waitingOnClients", async () => {
    mockPrisma.project.count = mock((args: { where: { status?: unknown } }) =>
      Promise.resolve(args.where.status === "in_review" ? 2 : 7),
    ) as never;
    mockPrisma.document.count.mockImplementation(((args: { where: { type?: unknown } }) =>
      Promise.resolve(args.where.type === "deliverable" ? 3 : 4)) as never);

    const stats = await service.getStats("org-1");

    expect(stats.inReview).toBe(2);
    expect(stats.waitingReviews).toBe(3);
    expect(stats.waitingSignatures).toBe(4);
    expect(stats.waitingOnClients).toBe(7);
  });

  it("getStats counts client-waiting documents in live projects, each document once", async () => {
    mockPrisma.project.count = mock(() => Promise.resolve(0));
    mockPrisma.document.count.mockClear();
    await service.getStats("org-1");
    const wheres = mockPrisma.document.count.mock.calls.map(
      (c) => (c as unknown as [{ where: Record<string, unknown> }])[0].where,
    );
    expect(wheres).toHaveLength(2);
    for (const where of wheres) {
      expect(where.project).toEqual({ organizationId: "org-1", archivedAt: null });
    }
    const signatures = wheres.find((w) => w.requiresSignature === true);
    expect(signatures?.type).toEqual({ not: "deliverable" });
  });

  it("findByClient adds checkbox-task progress and the latest client-visible activity", async () => {
    const projectUpdated = new Date("2026-06-01T10:00:00.000Z");
    const taskUpdated = new Date("2026-06-03T09:00:00.000Z");
    const postedUpdate = new Date("2026-06-05T09:00:00.000Z");
    mockPrisma.project.findMany.mockReturnValueOnce(
      Promise.resolve([
        { id: "p1", name: "Site", updatedAt: projectUpdated, _count: { documents: 0 }, updates: [{ createdAt: postedUpdate }], files: [] },
        { id: "p2", name: "Empty", updatedAt: projectUpdated, _count: { documents: 0 }, updates: [], files: [] },
      ]),
    );
    mockPrisma.project.count.mockReturnValueOnce(Promise.resolve(2));
    mockPrisma.task.groupBy.mockReturnValueOnce(
      Promise.resolve([
        { projectId: "p1", status: "done", _count: { _all: 2 }, _max: { updatedAt: taskUpdated } },
        { projectId: "p1", status: "open", _count: { _all: 1 }, _max: { updatedAt: projectUpdated } },
      ]),
    );

    const res = await service.findByClient("client-1", "org-1", {});

    expect(mockPrisma.task.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["projectId", "status"],
        where: {
          projectId: { in: ["p1", "p2"] },
          organizationId: "org-1",
          type: "checkbox",
          status: { not: "cancelled" },
        },
      }),
    );
    expect(res.data[0]).toEqual(
      expect.objectContaining({ taskCount: 3, completedTaskCount: 2, lastActivityAt: postedUpdate }),
    );
    expect(res.data[0]).not.toHaveProperty("updates");
    expect(res.data[0]).not.toHaveProperty("files");
    expect(res.data[1]).toEqual(
      expect.objectContaining({ taskCount: 0, completedTaskCount: 0, lastActivityAt: projectUpdated }),
    );
  });

  it("findOne excludes files that belong to a document", async () => {
    mockPrisma.project.findFirst.mockReturnValue(Promise.resolve({ id: "p1", files: [] }));
    await service.findOne("p1", "org-1");
    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          files: expect.objectContaining({
            where: { documents: { none: {} }, signedDocuments: { none: {} }, documentVersions: { none: {} } },
          }),
        }),
      }),
    );
  });

  it("findOne throws NotFoundException when not found", async () => {
    mockPrisma.project.findFirst.mockReturnValue(Promise.resolve(null));

    try {
      await service.findOne("nonexistent", "org-1");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundException);
    }
  });

  it("create creates a project with clientUserIds", async () => {
    const dto = { name: "New Project", clientUserIds: ["user-1", "user-2"] };
    await service.create(dto, "org-1");

    expect(mockPrisma.project.create).toHaveBeenCalledWith({
      data: {
        name: "New Project",
        organizationId: "org-1",
        clients: {
          create: [{ userId: "user-1" }, { userId: "user-2" }],
        },
      },
      include: { clients: { select: { userId: true } } },
    });
  });

  it("update with clientUserIds links contacts", async () => {
    mockPrisma.project.findFirst.mockReturnValue(
      Promise.resolve({ id: "p1", organizationId: "org-1", archivedAt: null }),
    );
    mockPrisma.member.count.mockReturnValue(Promise.resolve(1));

    await service.update("p1", { clientUserIds: ["u1"] }, "org-1");

    expect(mockContactSync.linkProjectClients).toHaveBeenCalledWith("p1", "org-1", ["u1"]);
  });

  it("update ends the contact links of clients taken off the project", async () => {
    mockPrisma.project.findFirst.mockReturnValue(
      Promise.resolve({ id: "p1", organizationId: "org-1", archivedAt: null }),
    );
    mockPrisma.member.count.mockReturnValue(Promise.resolve(1));
    mockPrisma.projectClient.findMany.mockReturnValueOnce(Promise.resolve([{ userId: "u1" }, { userId: "u2" }]));

    await service.update("p1", { clientUserIds: ["u1"] }, "org-1");

    // Inside the edit's transaction, after locking the project, so the client list can't be stale.
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockContactSync.endProjectClients).toHaveBeenCalledWith("p1", "org-1", ["u2"], mockPrisma);
    expect(mockContactSync.linkProjectClients).toHaveBeenCalledWith("p1", "org-1", ["u1"]);
  });

  it("update with no clients left ends every previous client's link", async () => {
    mockPrisma.project.findFirst.mockReturnValue(
      Promise.resolve({ id: "p1", organizationId: "org-1", archivedAt: null }),
    );
    mockPrisma.projectClient.findMany.mockReturnValueOnce(Promise.resolve([{ userId: "u1" }]));

    await service.update("p1", { clientUserIds: [] }, "org-1");

    expect(mockContactSync.endProjectClients).toHaveBeenCalledWith("p1", "org-1", ["u1"], mockPrisma);
    expect(mockContactSync.linkProjectClients).not.toHaveBeenCalled();
  });

  it("update still succeeds when contact sync fails", async () => {
    mockPrisma.project.findFirst.mockReturnValue(
      Promise.resolve({ id: "p1", organizationId: "org-1", archivedAt: null }),
    );
    mockPrisma.member.count.mockReturnValue(Promise.resolve(1));
    mockContactSync.linkProjectClients.mockReturnValueOnce(Promise.reject(new Error("boom")));

    const result = await service.update("p1", { clientUserIds: ["u1"] }, "org-1");

    expect(result).toBeDefined();
  });

  it("create links contacts for clientUserIds", async () => {
    mockPrisma.member.count.mockReturnValue(Promise.resolve(1));
    await service.create({ name: "X", clientUserIds: ["u1"] }, "org-1");
    expect(mockContactSync.linkProjectClients).toHaveBeenCalledWith("new-id", "org-1", ["u1"]);
  });

  it("create creates a project without clients when clientUserIds is empty", async () => {
    const dto = { name: "Solo Project" };
    await service.create(dto, "org-1");

    expect(mockPrisma.project.create).toHaveBeenCalledWith({
      data: {
        name: "Solo Project",
        organizationId: "org-1",
      },
      include: { clients: { select: { userId: true } } },
    });
  });

  it("remove deletes existing project", async () => {
    mockPrisma.project.deleteMany.mockReturnValue(Promise.resolve({ count: 1 }));

    await service.remove("1", "org-1");
    expect(mockPrisma.project.deleteMany).toHaveBeenCalledWith({
      where: { id: "1", organizationId: "org-1" },
    });
  });

  describe("findAll inactive projects", () => {
    const lastWhere = (): Record<string, unknown> =>
      (mockPrisma.project.findMany.mock.calls.at(-1) as unknown as [{ where: Record<string, unknown> }])[0].where;

    it("hides archived and cancelled projects by default", async () => {
      await service.findAll("org-1", {});
      expect(lastWhere()).toMatchObject({ archivedAt: null, status: { not: "cancelled" } });
    });

    it("shows archived and cancelled projects when archived=true", async () => {
      await service.findAll("org-1", { archived: "true" });
      expect(lastWhere().archivedAt).toBeUndefined();
      expect(lastWhere().status).toBeUndefined();
    });

    it("shows cancelled projects when filtering by the cancelled status", async () => {
      await service.findAll("org-1", { status: "cancelled" });
      expect(lastWhere()).toMatchObject({ archivedAt: null, status: "cancelled" });
    });
  });

  it("findOneByClient throws NotFoundException when project is archived", async () => {
    // The service queries with archivedAt: null — an archived project is excluded
    // at the database layer, so Prisma returns null for it.
    mockPrisma.project.findFirst.mockReturnValue(Promise.resolve(null));

    try {
      await service.findOneByClient("proj-archived", "user-client", "org-1");
      expect(true).toBe(false); // must not reach
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundException);
      expect((e as NotFoundException).message).toBe("Project not found");
    }

    // Confirm the query enforces archivedAt: null so archived projects are invisible
    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ archivedAt: null }),
      }),
    );
  });

  it("findOneByClient returns a non-archived project the client belongs to", async () => {
    const project = {
      id: "proj-active",
      name: "Active Project",
      organizationId: "org-1",
      archivedAt: null,
      files: [],
    };
    mockPrisma.project.findFirst.mockReturnValue(Promise.resolve(project));

    const result = await service.findOneByClient("proj-active", "user-client", "org-1");

    expect(result).toEqual({
      ...project,
      organization: { name: "Acme", members: [] },
      openVotes: 0,
    });
    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          files: expect.objectContaining({
            where: { documents: { none: {} }, signedDocuments: { none: {} }, documentVersions: { none: {} } },
          }),
        }),
        where: expect.objectContaining({
          id: "proj-active",
          organizationId: "org-1",
          archivedAt: null,
          clients: { some: { userId: "user-client" } },
        }),
      }),
    );
  });

  it("findOneByClient counts open decision tasks the client hasn't voted on, across all pages", async () => {
    mockPrisma.project.findFirst.mockReturnValue(
      Promise.resolve({ id: "p1", files: [], _count: { tasks: 3 } }),
    );

    const result = await service.findOneByClient("p1", "user-client", "org-1");

    expect(result).toEqual({
      id: "p1",
      files: [],
      organization: { name: "Acme", members: [] },
      openVotes: 3,
    });
    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: {
            select: {
              tasks: {
                where: {
                  type: "decision",
                  closedAt: null,
                  status: { notIn: ["done", "cancelled"] },
                  votes: { none: { userId: "user-client" } },
                },
              },
            },
          },
        }),
      }),
    );
  });

  describe("duplicate", () => {
    const sourceProject = {
      id: "src-1",
      name: "Source",
      description: "Original",
      status: "in_progress",
      startDate: null,
      endDate: null,
      organizationId: "org-1",
      clients: [{ userId: "u-1" }, { userId: "u-2" }],
      labels: [{ labelId: "lab-1" }],
      tasks: [
        {
          id: "t-1",
          title: "Kickoff",
          description: "Initial task",
          dueDate: null,
          status: "done",
          closedAt: new Date(),
          requestedById: null,
          assigneeId: "u-1",
          order: 0,
          type: "checkbox",
          question: null,
          options: [],
          labels: [{ labelId: "lab-1" }],
        },
        {
          id: "t-2",
          title: "Pick a direction",
          description: null,
          dueDate: null,
          status: "open",
          closedAt: null,
          requestedById: null,
          assigneeId: null,
          order: 1,
          type: "decision",
          question: "Which way?",
          options: [
            { label: "Option A", order: 0 },
            { label: "Option B", order: 1 },
          ],
          labels: [],
        },
      ],
    };

    it("throws NotFoundException when source project is not in the org", async () => {
      mockPrisma.project.findFirst.mockReturnValue(Promise.resolve(null));
      try {
        await service.duplicate("missing", { name: "Copy" }, "org-1");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
      }
    });

    it("copies project core fields, labels, tasks, options, and task labels (no clients by default)", async () => {
      mockPrisma.project.findFirst.mockReturnValue(Promise.resolve(sourceProject));
      mockPrisma.project.create.mockReturnValue(
        Promise.resolve({ id: "new-1", name: "Copy", organizationId: "org-1" }),
      );
      mockPrisma.project.findUnique.mockReturnValue(
        Promise.resolve({ id: "new-1", name: "Copy", organizationId: "org-1", clients: [] }),
      );

      const result = await service.duplicate("src-1", { name: "Copy" }, "org-1");

      // New project created with source's core fields; status is NOT copied —
      // the schema default ("not_started") applies instead.
      expect(mockPrisma.project.create).toHaveBeenCalledWith({
        data: {
          name: "Copy",
          description: "Original",
          startDate: null,
          endDate: null,
          organizationId: "org-1",
        },
      });

      // Project labels cloned
      expect(mockPrisma.projectLabel.createMany).toHaveBeenCalledWith({
        data: [{ projectId: "new-1", labelId: "lab-1" }],
      });

      // Clients NOT copied by default
      expect(mockPrisma.projectClient.createMany).not.toHaveBeenCalled();

      // Tasks copied with status/assignment state reset
      expect(mockPrisma.task.createMany).toHaveBeenCalledTimes(1);
      const taskRows = (mockPrisma.task.createMany.mock.calls[0][0] as PrismaArgs).data as Array<Record<string, unknown>>;
      expect(taskRows.length).toBe(2);
      const firstTaskData = taskRows[0];
      expect(firstTaskData.status).toBe("open");
      expect(firstTaskData.closedAt).toBe(null);
      expect(firstTaskData.dueDate).toBe(null);
      expect(firstTaskData.requestedById).toBe(null);
      expect(firstTaskData.assigneeId).toBe(null);
      expect(firstTaskData.title).toBe("Kickoff");
      expect(firstTaskData.projectId).toBe("new-1");
      expect(firstTaskData.organizationId).toBe("org-1");

      // Pre-generated ids tie options and labels to the right tasks
      const secondId = taskRows[1].id as string;
      const firstId = taskRows[0].id as string;
      expect(firstId).not.toBe(secondId);

      // Decision options copied for the second task
      expect(mockPrisma.decisionOption.createMany).toHaveBeenCalledTimes(1);
      const optCall = mockPrisma.decisionOption.createMany.mock.calls[0][0] as PrismaArgs;
      const optData = optCall.data as Array<Record<string, unknown>>;
      expect(optData.map((o) => o.label)).toEqual(["Option A", "Option B"]);
      expect(optData.every((o) => o.taskId === secondId)).toBe(true);

      // Task label copied for the first task only
      expect(mockPrisma.taskLabel.createMany).toHaveBeenCalledTimes(1);

      expect(result).toEqual({ id: "new-1", name: "Copy", organizationId: "org-1", clients: [] });
    });

    it("skips tasks when includeTasks is false", async () => {
      mockPrisma.project.findFirst.mockReturnValue(Promise.resolve(sourceProject));
      mockPrisma.project.create.mockReturnValue(
        Promise.resolve({ id: "new-2", name: "NoTasks", organizationId: "org-1" }),
      );
      mockPrisma.project.findUnique.mockReturnValue(
        Promise.resolve({ id: "new-2", name: "NoTasks", organizationId: "org-1", clients: [] }),
      );

      await service.duplicate("src-1", { name: "NoTasks", includeTasks: false }, "org-1");

      expect(mockPrisma.task.createMany).not.toHaveBeenCalled();
      expect(mockPrisma.decisionOption.createMany).not.toHaveBeenCalled();
      expect(mockPrisma.taskLabel.createMany).not.toHaveBeenCalled();
      // Labels on the project are still copied
      expect(mockPrisma.projectLabel.createMany).toHaveBeenCalled();
    });

    it("copies clients when includeClients is true", async () => {
      mockPrisma.project.findFirst.mockReturnValue(Promise.resolve(sourceProject));
      mockPrisma.project.create.mockReturnValue(
        Promise.resolve({ id: "new-3", name: "WithClients", organizationId: "org-1" }),
      );
      mockPrisma.project.findUnique.mockReturnValue(
        Promise.resolve({ id: "new-3", name: "WithClients", organizationId: "org-1", clients: [] }),
      );

      await service.duplicate(
        "src-1",
        { name: "WithClients", includeTasks: false, includeClients: true },
        "org-1",
      );

      expect(mockPrisma.projectClient.createMany).toHaveBeenCalledWith({
        data: [
          { projectId: "new-3", userId: "u-1" },
          { projectId: "new-3", userId: "u-2" },
        ],
      });
      expect(mockContactSync.linkProjectClients).toHaveBeenCalledWith("new-3", "org-1", ["u-1", "u-2"]);
    });

    it("does not link contacts when clients are not copied", async () => {
      mockPrisma.project.findFirst.mockReturnValue(Promise.resolve(sourceProject));
      mockPrisma.project.create.mockReturnValue(
        Promise.resolve({ id: "new-4", name: "NoClients", organizationId: "org-1" }),
      );
      mockPrisma.project.findUnique.mockReturnValue(
        Promise.resolve({ id: "new-4", name: "NoClients", organizationId: "org-1", clients: [] }),
      );

      await service.duplicate("src-1", { name: "NoClients", includeTasks: false }, "org-1");

      expect(mockContactSync.linkProjectClients).not.toHaveBeenCalled();
    });

    it("scopes the source lookup to the provided organizationId", async () => {
      mockPrisma.project.findFirst.mockReturnValue(Promise.resolve(null));
      try {
        await service.duplicate("src-1", { name: "X" }, "org-other");
      } catch {
        // expected
      }
      expect(mockPrisma.project.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "src-1", organizationId: "org-other" }),
        }),
      );
    });
  });
});
