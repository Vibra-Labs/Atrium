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
  },
  projectStatus: {
    findMany: mock(() => Promise.resolve([])),
    findFirst: mock(() => Promise.resolve(null)),
  },
  member: {
    count: mock(() => Promise.resolve(2)),
  },
  $transaction: mock((args: Promise<unknown>[]) => Promise.all(args)),
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
});
