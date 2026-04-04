import { describe, expect, it, mock, beforeEach } from "bun:test";
import { SearchService } from "./search.service";
import type { PrismaService } from "../prisma/prisma.service";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ORG = "org-1";
const QUERY = "alpha";

interface PrismaArgs {
  where?: Record<string, unknown>;
  select?: Record<string, unknown>;
  take?: number;
}

// ---------------------------------------------------------------------------
// Mock Prisma client
// ---------------------------------------------------------------------------

const mockPrisma = {
  project: {
    findMany: mock(() => Promise.resolve([])),
  },
  task: {
    findMany: mock(() => Promise.resolve([])),
  },
  file: {
    findMany: mock(() => Promise.resolve([])),
  },
  member: {
    findMany: mock(() => Promise.resolve([])),
  },
  clientProfile: {
    findMany: mock(() => Promise.resolve([])),
  },
};

// ---------------------------------------------------------------------------
// Helpers to build stub records
// ---------------------------------------------------------------------------

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    name: "Alpha Project",
    description: null,
    status: null,
    ...overrides,
  };
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Alpha Task",
    description: null,
    projectId: "proj-1",
    project: { id: "proj-1", name: "Alpha Project" },
    ...overrides,
  };
}

function makeFile(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    filename: "alpha-design.png",
    projectId: "proj-1",
    project: { id: "proj-1", name: "Alpha Project" },
    ...overrides,
  };
}

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    id: "member-1",
    userId: "user-1",
    user: { id: "user-1", name: "Alice Alpha", email: "alice@example.com" },
    ...overrides,
  };
}

function makeClientProfile(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    company: "Alpha Corp",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: clear all mocks between tests
// ---------------------------------------------------------------------------

function clearAllMocks() {
  mockPrisma.project.findMany.mockClear();
  mockPrisma.task.findMany.mockClear();
  mockPrisma.file.findMany.mockClear();
  mockPrisma.member.findMany.mockClear();
  mockPrisma.clientProfile.findMany.mockClear();
}

function resetAllMocksToEmpty() {
  mockPrisma.project.findMany.mockReturnValue(Promise.resolve([]));
  mockPrisma.task.findMany.mockReturnValue(Promise.resolve([]));
  mockPrisma.file.findMany.mockReturnValue(Promise.resolve([]));
  mockPrisma.member.findMany.mockReturnValue(Promise.resolve([]));
  mockPrisma.clientProfile.findMany.mockReturnValue(Promise.resolve([]));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SearchService", () => {
  let service: SearchService;

  beforeEach(() => {
    clearAllMocks();
    resetAllMocksToEmpty();
    service = new SearchService(mockPrisma as unknown as PrismaService);
  });

  // =========================================================================
  // Return shape
  // =========================================================================

  describe("return shape", () => {
    it("returns an object with projects, tasks, files, and clients keys", async () => {
      const result = await service.search(ORG, QUERY);

      expect(result).toHaveProperty("projects");
      expect(result).toHaveProperty("tasks");
      expect(result).toHaveProperty("files");
      expect(result).toHaveProperty("clients");
    });

    it("returns arrays for all four keys when there are no matches", async () => {
      const result = await service.search(ORG, QUERY);

      expect(Array.isArray(result.projects)).toBe(true);
      expect(Array.isArray(result.tasks)).toBe(true);
      expect(Array.isArray(result.files)).toBe(true);
      expect(Array.isArray(result.clients)).toBe(true);
    });

    it("returns empty arrays for all four keys when nothing matches", async () => {
      const result = await service.search(ORG, QUERY);

      expect(result.projects).toHaveLength(0);
      expect(result.tasks).toHaveLength(0);
      expect(result.files).toHaveLength(0);
      expect(result.clients).toHaveLength(0);
    });

    it("returns matching data in all four result arrays when matches exist", async () => {
      const project = makeProject();
      const task = makeTask();
      const file = makeFile();
      const member = makeMember();
      const profile = makeClientProfile();

      mockPrisma.project.findMany.mockReturnValue(Promise.resolve([project]));
      mockPrisma.task.findMany.mockReturnValue(Promise.resolve([task]));
      mockPrisma.file.findMany.mockReturnValue(Promise.resolve([file]));
      mockPrisma.member.findMany.mockReturnValue(Promise.resolve([member]));
      mockPrisma.clientProfile.findMany.mockReturnValue(
        Promise.resolve([profile]),
      );

      const result = await service.search(ORG, QUERY);

      expect(result.projects).toHaveLength(1);
      expect(result.tasks).toHaveLength(1);
      expect(result.files).toHaveLength(1);
      expect(result.clients).toHaveLength(1);
    });
  });

  // =========================================================================
  // Project queries
  // =========================================================================

  describe("project search", () => {
    it("queries projects scoped to the provided organizationId", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG }),
        }),
      );
    });

    it("excludes archived projects by filtering archivedAt: null", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ archivedAt: null }),
        }),
      );
    });

    it("searches projects by name using case-insensitive contains", async () => {
      await service.search(ORG, QUERY);

      const call = (
        mockPrisma.project.findMany as ReturnType<typeof mock>
      ).mock.calls[0][0] as PrismaArgs;
      const or = (call.where?.OR as Record<string, unknown>[]) ?? [];
      expect(
        or.some(
          (clause) =>
            JSON.stringify(clause).includes("name") &&
            JSON.stringify(clause).includes("insensitive"),
        ),
      ).toBe(true);
    });

    it("searches projects by description using case-insensitive contains", async () => {
      await service.search(ORG, QUERY);

      const call = (
        mockPrisma.project.findMany as ReturnType<typeof mock>
      ).mock.calls[0][0] as PrismaArgs;
      const or = (call.where?.OR as Record<string, unknown>[]) ?? [];
      expect(
        or.some(
          (clause) =>
            JSON.stringify(clause).includes("description") &&
            JSON.stringify(clause).includes("insensitive"),
        ),
      ).toBe(true);
    });

    it("caps project results at 5", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it("selects only id, name, description, and status fields for projects", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { id: true, name: true, description: true, status: true },
        }),
      );
    });

    it("returns the project records returned by Prisma", async () => {
      const projects = [
        makeProject({ id: "p-1", name: "Alpha 1" }),
        makeProject({ id: "p-2", name: "Alpha 2" }),
      ];
      mockPrisma.project.findMany.mockReturnValue(Promise.resolve(projects));

      const result = await service.search(ORG, QUERY);

      expect(result.projects).toEqual(projects);
    });
  });

  // =========================================================================
  // Task queries
  // =========================================================================

  describe("task search", () => {
    it("queries tasks scoped to the provided organizationId", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG }),
        }),
      );
    });

    it("searches tasks by title using case-insensitive contains", async () => {
      await service.search(ORG, QUERY);

      const call = (
        mockPrisma.task.findMany as ReturnType<typeof mock>
      ).mock.calls[0][0] as PrismaArgs;
      const or = (call.where?.OR as Record<string, unknown>[]) ?? [];
      expect(
        or.some(
          (clause) =>
            JSON.stringify(clause).includes("title") &&
            JSON.stringify(clause).includes("insensitive"),
        ),
      ).toBe(true);
    });

    it("searches tasks by description using case-insensitive contains", async () => {
      await service.search(ORG, QUERY);

      const call = (
        mockPrisma.task.findMany as ReturnType<typeof mock>
      ).mock.calls[0][0] as PrismaArgs;
      const or = (call.where?.OR as Record<string, unknown>[]) ?? [];
      expect(
        or.some(
          (clause) =>
            JSON.stringify(clause).includes("description") &&
            JSON.stringify(clause).includes("insensitive"),
        ),
      ).toBe(true);
    });

    it("caps task results at 5", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it("includes nested project id and name in task select", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            project: { select: { id: true, name: true } },
          }),
        }),
      );
    });

    it("returns the task records returned by Prisma", async () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Alpha 1" }),
        makeTask({ id: "t-2", title: "Alpha 2" }),
      ];
      mockPrisma.task.findMany.mockReturnValue(Promise.resolve(tasks));

      const result = await service.search(ORG, QUERY);

      expect(result.tasks).toEqual(tasks);
    });
  });

  // =========================================================================
  // File queries
  // =========================================================================

  describe("file search", () => {
    it("queries files scoped to the provided organizationId", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.file.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG }),
        }),
      );
    });

    it("searches files by filename using case-insensitive contains", async () => {
      await service.search(ORG, QUERY);

      const call = (
        mockPrisma.file.findMany as ReturnType<typeof mock>
      ).mock.calls[0][0] as PrismaArgs;
      const filename = call.where?.filename as Record<string, unknown>;
      expect(filename?.contains).toBe(QUERY);
      expect(filename?.mode).toBe("insensitive");
    });

    it("caps file results at 5", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.file.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it("includes nested project id and name in file select", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.file.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            project: { select: { id: true, name: true } },
          }),
        }),
      );
    });

    it("returns the file records returned by Prisma", async () => {
      const files = [
        makeFile({ id: "f-1", filename: "alpha-logo.svg" }),
        makeFile({ id: "f-2", filename: "alpha-report.pdf" }),
      ];
      mockPrisma.file.findMany.mockReturnValue(Promise.resolve(files));

      const result = await service.search(ORG, QUERY);

      expect(result.files).toEqual(files);
    });
  });

  // =========================================================================
  // Member / client queries
  // =========================================================================

  describe("member search", () => {
    it("queries members scoped to the provided organizationId", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.member.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG }),
        }),
      );
    });

    it("restricts member search to role 'member' (excludes owners and admins)", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.member.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: "member" }),
        }),
      );
    });

    it("searches members by user name using case-insensitive contains", async () => {
      await service.search(ORG, QUERY);

      const call = (
        mockPrisma.member.findMany as ReturnType<typeof mock>
      ).mock.calls[0][0] as PrismaArgs;
      const userFilter = call.where?.user as Record<string, unknown>;
      const or = (userFilter?.OR as Record<string, unknown>[]) ?? [];
      expect(
        or.some(
          (clause) =>
            JSON.stringify(clause).includes("name") &&
            JSON.stringify(clause).includes("insensitive"),
        ),
      ).toBe(true);
    });

    it("searches members by user email using case-insensitive contains", async () => {
      await service.search(ORG, QUERY);

      const call = (
        mockPrisma.member.findMany as ReturnType<typeof mock>
      ).mock.calls[0][0] as PrismaArgs;
      const userFilter = call.where?.user as Record<string, unknown>;
      const or = (userFilter?.OR as Record<string, unknown>[]) ?? [];
      expect(
        or.some(
          (clause) =>
            JSON.stringify(clause).includes("email") &&
            JSON.stringify(clause).includes("insensitive"),
        ),
      ).toBe(true);
    });

    it("caps member results at 5", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.member.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it("includes user id, name, and email in member select", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.member.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            user: { select: { id: true, name: true, email: true } },
          }),
        }),
      );
    });
  });

  // =========================================================================
  // clientProfile enrichment
  // =========================================================================

  describe("clientProfile enrichment", () => {
    it("skips the clientProfile query entirely when no members are found", async () => {
      mockPrisma.member.findMany.mockReturnValue(Promise.resolve([]));

      await service.search(ORG, QUERY);

      expect(mockPrisma.clientProfile.findMany).not.toHaveBeenCalled();
    });

    it("queries clientProfile when at least one member is found", async () => {
      const member = makeMember({ userId: "user-1" });
      mockPrisma.member.findMany.mockReturnValue(Promise.resolve([member]));

      await service.search(ORG, QUERY);

      expect(mockPrisma.clientProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: { in: ["user-1"] } },
        }),
      );
    });

    it("passes all member userIds to the clientProfile query", async () => {
      const members = [
        makeMember({ id: "m-1", userId: "user-1" }),
        makeMember({ id: "m-2", userId: "user-2" }),
        makeMember({ id: "m-3", userId: "user-3" }),
      ];
      mockPrisma.member.findMany.mockReturnValue(Promise.resolve(members));

      await service.search(ORG, QUERY);

      const call = (
        mockPrisma.clientProfile.findMany as ReturnType<typeof mock>
      ).mock.calls[0][0] as PrismaArgs;
      const inIds = (call.where?.userId as { in: string[] }).in;
      expect(inIds).toEqual(expect.arrayContaining(["user-1", "user-2", "user-3"]));
      expect(inIds).toHaveLength(3);
    });

    it("attaches the company from clientProfile to the corresponding client entry", async () => {
      const member = makeMember({ userId: "user-1" });
      const profile = makeClientProfile({ userId: "user-1", company: "Alpha Corp" });
      mockPrisma.member.findMany.mockReturnValue(Promise.resolve([member]));
      mockPrisma.clientProfile.findMany.mockReturnValue(
        Promise.resolve([profile]),
      );

      const result = await service.search(ORG, QUERY);

      expect(result.clients[0].company).toBe("Alpha Corp");
    });

    it("sets company to null when a member has no matching clientProfile", async () => {
      const member = makeMember({ userId: "user-no-profile" });
      mockPrisma.member.findMany.mockReturnValue(Promise.resolve([member]));
      mockPrisma.clientProfile.findMany.mockReturnValue(Promise.resolve([]));

      const result = await service.search(ORG, QUERY);

      expect(result.clients[0].company).toBeNull();
    });

    it("correctly maps company to each client when multiple members have profiles", async () => {
      const members = [
        makeMember({ id: "m-1", userId: "user-1", user: { id: "user-1", name: "Alice", email: "alice@example.com" } }),
        makeMember({ id: "m-2", userId: "user-2", user: { id: "user-2", name: "Bob", email: "bob@example.com" } }),
      ];
      const profiles = [
        { userId: "user-1", company: "Alpha Corp" },
        { userId: "user-2", company: "Beta Ltd" },
      ];
      mockPrisma.member.findMany.mockReturnValue(Promise.resolve(members));
      mockPrisma.clientProfile.findMany.mockReturnValue(
        Promise.resolve(profiles),
      );

      const result = await service.search(ORG, QUERY);

      const alice = result.clients.find((c) => c.userId === "user-1");
      const bob = result.clients.find((c) => c.userId === "user-2");
      expect(alice?.company).toBe("Alpha Corp");
      expect(bob?.company).toBe("Beta Ltd");
    });

    it("correctly sets company to null for a member with no profile while others have profiles", async () => {
      const members = [
        makeMember({ id: "m-1", userId: "user-has-profile" }),
        makeMember({ id: "m-2", userId: "user-no-profile" }),
      ];
      const profiles = [{ userId: "user-has-profile", company: "Gamma Inc" }];
      mockPrisma.member.findMany.mockReturnValue(Promise.resolve(members));
      mockPrisma.clientProfile.findMany.mockReturnValue(
        Promise.resolve(profiles),
      );

      const result = await service.search(ORG, QUERY);

      const withProfile = result.clients.find(
        (c) => c.userId === "user-has-profile",
      );
      const withoutProfile = result.clients.find(
        (c) => c.userId === "user-no-profile",
      );
      expect(withProfile?.company).toBe("Gamma Inc");
      expect(withoutProfile?.company).toBeNull();
    });

    it("preserves all original member fields in the enriched client record", async () => {
      const member = makeMember({
        id: "m-1",
        userId: "user-1",
        user: { id: "user-1", name: "Alice Alpha", email: "alice@example.com" },
      });
      const profile = makeClientProfile({ userId: "user-1", company: "Alpha Corp" });
      mockPrisma.member.findMany.mockReturnValue(Promise.resolve([member]));
      mockPrisma.clientProfile.findMany.mockReturnValue(
        Promise.resolve([profile]),
      );

      const result = await service.search(ORG, QUERY);

      expect(result.clients[0].id).toBe("m-1");
      expect(result.clients[0].userId).toBe("user-1");
      expect(result.clients[0].user).toEqual({
        id: "user-1",
        name: "Alice Alpha",
        email: "alice@example.com",
      });
      expect(result.clients[0].company).toBe("Alpha Corp");
    });
  });

  // =========================================================================
  // Parallel execution — all four primary queries are always fired
  // =========================================================================

  describe("parallel query execution", () => {
    it("always calls all four primary Prisma queries regardless of results", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.project.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.task.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.file.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.member.findMany).toHaveBeenCalledTimes(1);
    });

    it("always passes the search term to every primary query", async () => {
      await service.search(ORG, "uniqueterm");

      const projectCall = (
        mockPrisma.project.findMany as ReturnType<typeof mock>
      ).mock.calls[0][0] as PrismaArgs;
      const taskCall = (
        mockPrisma.task.findMany as ReturnType<typeof mock>
      ).mock.calls[0][0] as PrismaArgs;
      const fileCall = (
        mockPrisma.file.findMany as ReturnType<typeof mock>
      ).mock.calls[0][0] as PrismaArgs;

      expect(JSON.stringify(projectCall)).toContain("uniqueterm");
      expect(JSON.stringify(taskCall)).toContain("uniqueterm");
      expect(JSON.stringify(fileCall)).toContain("uniqueterm");
    });
  });

  // =========================================================================
  // Result cap (take: 5)
  // =========================================================================

  describe("result capping", () => {
    it("respects the 5-result cap — Prisma returns at most 5 items per entity", async () => {
      // The service passes take: 5 to Prisma; here we verify that the
      // service itself does not add extra filtering on top of what Prisma returns.
      const fiveProjects = Array.from({ length: 5 }, (_, i) =>
        makeProject({ id: `p-${i}`, name: `Alpha ${i}` }),
      );
      mockPrisma.project.findMany.mockReturnValue(
        Promise.resolve(fiveProjects),
      );

      const result = await service.search(ORG, QUERY);

      // Should return exactly 5 — the cap applied by Prisma
      expect(result.projects).toHaveLength(5);
    });
  });

  // =========================================================================
  // Isolation between calls
  // =========================================================================

  describe("isolation between calls", () => {
    it("returns fresh results on each invocation — prior mock state does not bleed over", async () => {
      mockPrisma.project.findMany.mockReturnValue(
        Promise.resolve([makeProject({ id: "p-first" })]),
      );
      await service.search(ORG, QUERY);

      // Second call returns different data
      mockPrisma.project.findMany.mockReturnValue(Promise.resolve([]));
      const second = await service.search(ORG, "beta");

      expect(second.projects).toHaveLength(0);
    });
  });
});
