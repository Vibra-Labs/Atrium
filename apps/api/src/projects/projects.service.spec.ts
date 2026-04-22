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
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
    createMany: mock(() => Promise.resolve({ count: 0 })),
  },
  projectLabel: {
    createMany: mock(() => Promise.resolve({ count: 0 })),
  },
  task: {
    create: mock((args: PrismaArgs) =>
      Promise.resolve({ id: `task-${Math.random().toString(36).slice(2, 8)}`, ...args.data }),
    ),
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
  $transaction: mock((arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof mockPrisma) => Promise<unknown>)(mockPrisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  }),
};

describe("ProjectsService", () => {
  let service: ProjectsService;

  beforeEach(() => {
    service = new ProjectsService(mockPrisma as unknown as PrismaService);
    // Reset mocks
    Object.values(mockPrisma.project).forEach((m) => {
      if (typeof m === "function" && "mockClear" in m) {
        (m as ReturnType<typeof mock>).mockClear?.();
      }
    });
    mockPrisma.projectClient.deleteMany.mockClear();
    mockPrisma.projectClient.createMany.mockClear();
    mockPrisma.projectLabel.createMany.mockClear();
    mockPrisma.task.create.mockClear();
    mockPrisma.taskLabel.createMany.mockClear();
    mockPrisma.decisionOption.createMany.mockClear();
    mockPrisma.$transaction.mockClear();
  });

  it("findAll returns projects for organization", async () => {
    const projects = [
      { id: "1", name: "Test", organizationId: "org-1", clients: [] },
    ];
    mockPrisma.project.findMany.mockReturnValue(Promise.resolve(projects));
    mockPrisma.project.count = mock(() => Promise.resolve(1));

    const result = await service.findAll("org-1", {});
    expect(result.data).toEqual(projects);
    expect(result.meta.total).toBe(1);
    expect(result.meta.page).toBe(1);
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

    expect(result).toEqual(project);
    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "proj-active",
          organizationId: "org-1",
          archivedAt: null,
          clients: { some: { userId: "user-client" } },
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

      // New project created with source's core fields
      expect(mockPrisma.project.create).toHaveBeenCalledWith({
        data: {
          name: "Copy",
          description: "Original",
          status: "in_progress",
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

      // Tasks copied with status reset
      expect(mockPrisma.task.create).toHaveBeenCalledTimes(2);
      const taskCalls = mockPrisma.task.create.mock.calls;
      const firstTaskData = (taskCalls[0][0] as PrismaArgs).data as Record<string, unknown>;
      expect(firstTaskData.status).toBe("open");
      expect(firstTaskData.closedAt).toBe(null);
      expect(firstTaskData.title).toBe("Kickoff");
      expect(firstTaskData.projectId).toBe("new-1");
      expect(firstTaskData.organizationId).toBe("org-1");

      // Decision options copied for the second task
      expect(mockPrisma.decisionOption.createMany).toHaveBeenCalledTimes(1);
      const optCall = mockPrisma.decisionOption.createMany.mock.calls[0][0] as PrismaArgs;
      const optData = optCall.data as Array<Record<string, unknown>>;
      expect(optData.map((o) => o.label)).toEqual(["Option A", "Option B"]);

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

      expect(mockPrisma.task.create).not.toHaveBeenCalled();
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
