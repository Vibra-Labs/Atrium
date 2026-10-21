import { describe, expect, it, mock, beforeEach } from "bun:test";
import { SearchService } from "./search.service";
import type { PrismaService } from "../prisma/prisma.service";
import { SearchController } from "./search.controller";
import { ROLES_KEY } from "../common/decorators/roles.decorator";

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
  contact: {
    findMany: mock(() => Promise.resolve([])),
  },
  company: {
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

// ---------------------------------------------------------------------------
// Helper: clear all mocks between tests
// ---------------------------------------------------------------------------

function clearAllMocks() {
  mockPrisma.project.findMany.mockClear();
  mockPrisma.task.findMany.mockClear();
  mockPrisma.file.findMany.mockClear();
  mockPrisma.member.findMany.mockClear();
  mockPrisma.contact.findMany.mockClear();
  mockPrisma.company.findMany.mockClear();
}

function resetAllMocksToEmpty() {
  mockPrisma.project.findMany.mockReturnValue(Promise.resolve([]));
  mockPrisma.task.findMany.mockReturnValue(Promise.resolve([]));
  mockPrisma.file.findMany.mockReturnValue(Promise.resolve([]));
  mockPrisma.member.findMany.mockReturnValue(Promise.resolve([]));
  mockPrisma.contact.findMany.mockReturnValue(Promise.resolve([]));
  mockPrisma.company.findMany.mockReturnValue(Promise.resolve([]));
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
    it("returns projects, tasks, files, contacts and companies, and no clients group", async () => {
      const result = await service.search(ORG, QUERY);

      expect(Object.keys(result).sort()).toEqual(["companies", "contacts", "files", "projects", "tasks"]);
      expect(result).not.toHaveProperty("clients");
    });

    it("returns empty arrays when nothing matches", async () => {
      const result = await service.search(ORG, QUERY);

      expect(result.projects).toHaveLength(0);
      expect(result.tasks).toHaveLength(0);
      expect(result.files).toHaveLength(0);
      expect(result.contacts).toHaveLength(0);
      expect(result.companies).toHaveLength(0);
    });

    it("returns matching data in each result array when matches exist", async () => {
      mockPrisma.project.findMany.mockReturnValue(Promise.resolve([makeProject()]));
      mockPrisma.task.findMany.mockReturnValue(Promise.resolve([makeTask()]));
      mockPrisma.file.findMany.mockReturnValue(Promise.resolve([makeFile()]));

      const result = await service.search(ORG, QUERY);

      expect(result.projects).toHaveLength(1);
      expect(result.tasks).toHaveLength(1);
      expect(result.files).toHaveLength(1);
    });

    it("finds a portal client once, as a contact, without querying members", async () => {
      mockPrisma.contact.findMany.mockReturnValue(
        Promise.resolve([{ id: "c-1", name: "Alice Alpha", email: "alice@example.com", company: { name: "Alpha Corp" } }]),
      );

      const result = await service.search(ORG, QUERY);

      expect(mockPrisma.member.findMany).not.toHaveBeenCalled();
      expect(result.contacts).toEqual([
        { id: "c-1", name: "Alice Alpha", email: "alice@example.com", company: "Alpha Corp" },
      ]);
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

    it("skips task descriptions for queries shorter than 3 characters", async () => {
      await service.search(ORG, "ab");

      const call = (
        mockPrisma.task.findMany as ReturnType<typeof mock>
      ).mock.calls[0][0] as PrismaArgs;
      const or = (call.where?.OR as Record<string, unknown>[]) ?? [];
      expect(or).toHaveLength(1);
      expect(JSON.stringify(or)).not.toContain("description");
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
  // Parallel execution — every primary query is always fired
  // =========================================================================

  describe("parallel query execution", () => {
    it("always calls every primary Prisma query regardless of results", async () => {
      await service.search(ORG, QUERY);

      expect(mockPrisma.project.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.task.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.file.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.contact.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.company.findMany).toHaveBeenCalledTimes(1);
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
  // Contacts and companies
  // =========================================================================

  describe("contacts and companies", () => {
    it("search includes contacts for staff", async () => {
      mockPrisma.contact.findMany.mockReturnValue(
        Promise.resolve([
          { id: "c-1", name: "Ann Alpha", email: "ann@x.com", company: { name: "Alpha Co" } },
          { id: "c-2", name: "Al Alpha", email: null, company: null },
        ]),
      );
      mockPrisma.company.findMany.mockReturnValue(
        Promise.resolve([{ id: "co-1", name: "Alpha Co" }]),
      );

      const result = await service.search(ORG, QUERY);

      expect(result.contacts).toEqual([
        { id: "c-1", name: "Ann Alpha", email: "ann@x.com", company: "Alpha Co" },
        { id: "c-2", name: "Al Alpha", email: null, company: null },
      ]);
      expect(result.companies).toEqual([{ id: "co-1", name: "Alpha Co" }]);
    });

    it("scopes contact and company queries to the org, insensitive, take 5", async () => {
      await service.search(ORG, QUERY);

      const contactCall = (mockPrisma.contact.findMany as ReturnType<typeof mock>)
        .mock.calls[0][0] as PrismaArgs;
      expect(contactCall.where?.organizationId).toBe(ORG);
      expect(contactCall.take).toBe(5);
      const json = JSON.stringify(contactCall.where);
      expect(json).toContain("email");
      expect(json).toContain("company");
      expect(json).toContain("insensitive");

      expect(mockPrisma.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG }),
          take: 5,
        }),
      );
    });

    it("search excludes contacts for clients: the controller is owner/admin only", () => {
      expect(Reflect.getMetadata(ROLES_KEY, SearchController)).toEqual([
        "owner",
        "admin",
      ]);
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
