import { describe, expect, it, beforeEach } from "bun:test";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ProjectStatusesService } from "./project-statuses.service";

interface Status {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  order: number;
  color: string;
}
interface Project {
  id: string;
  organizationId: string;
  status: string;
}
type Where = Record<string, unknown>;

const ORG = "org-1";
const matches = (row: object, where: Where = {}): boolean =>
  Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v);
const byOrder = (a: Status, b: Status): number => a.order - b.order;

/** Just enough of Prisma for the service. */
function fakeDb(statuses: Status[], projects: Project[]) {
  let next = 100;
  const db = {
    /** Runs when a transaction starts, standing in for another admin's commit that lands first. */
    beforeTransaction: null as null | (() => void),
    locks: [] as string[],
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      db.locks.push(`${strings.join("?")}|${values.join(",")}`);
      return 1;
    },
    projectStatus: {
      findMany: async ({ where }: { where: Where }) => statuses.filter((s) => matches(s, where)).sort(byOrder),
      findFirst: async ({ where }: { where: Where }) => statuses.filter((s) => matches(s, where))[0] ?? null,
      create: async ({ data }: { data: Omit<Status, "id"> }) => {
        const row: Status = { id: `s-${next++}`, ...data };
        statuses.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Status> }) => {
        const row = statuses.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        statuses.splice(statuses.findIndex((s) => s.id === where.id), 1);
      },
    },
    project: {
      updateMany: async ({ where, data }: { where: Where; data: Partial<Project> }) => {
        const rows = projects.filter((p) => matches(p, where));
        rows.forEach((p) => Object.assign(p, data));
        return { count: rows.length };
      },
    },
    $transaction: async (arg: unknown) => {
      db.beforeTransaction?.();
      db.beforeTransaction = null;
      return typeof arg === "function" ? (arg as (tx: unknown) => Promise<unknown>)(db) : Promise.all(arg as Promise<unknown>[]);
    },
  };
  return db;
}

function status(id: string, name: string, slug: string, order: number, org: string = ORG): Status {
  return { id, organizationId: org, name, slug, order, color: "#6b7280" };
}

describe("ProjectStatusesService", () => {
  let statuses: Status[];
  let projects: Project[];
  let db: ReturnType<typeof fakeDb>;
  let service: ProjectStatusesService;

  beforeEach(() => {
    statuses = [
      status("ns", "Not Started", "not_started", 0),
      status("ip", "In Progress", "in_progress", 1),
      status("ir", "In Review", "in_review", 2),
      status("co", "Completed", "completed", 3),
      status("ca", "Cancelled", "cancelled", 4),
      status("x", "Theirs", "theirs", 0, "org-2"),
    ];
    projects = [];
    db = fakeDb(statuses, projects);
    service = new ProjectStatusesService(db as never);
  });

  const names = (): string[] => statuses.filter((s) => s.organizationId === ORG).sort(byOrder).map((s) => s.name);

  it("create adds a status at the end with a slug from its name and the chosen color", async () => {
    const created = await service.create({ name: "  Client review ", color: "#8b5cf6" }, ORG);
    expect(created).toMatchObject({ name: "Client review", slug: "client_review", order: 5, color: "#8b5cf6" });
  });

  it("create never reuses a taken slug, and rejects a duplicate name, a blank name or too many", async () => {
    // A status renamed away from "Completed" still owns the slug "completed".
    await service.update("co", { name: "Delivered" }, ORG);
    expect((await service.create({ name: "Completed" }, ORG)).slug).toBe("completed_2");
    await expect(service.create({ name: "in progress" }, ORG)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.create({ name: " " }, ORG)).rejects.toBeInstanceOf(BadRequestException);
    for (let i = 0; i < 9; i++) await service.create({ name: `S${i}` }, ORG);
    await expect(service.create({ name: "One more" }, ORG)).rejects.toThrow("A workspace can have at most 15 statuses");
  });

  it("update renames and recolors any status, built-in ones too, keeping the slug", async () => {
    const updated = await service.update("co", { name: "Delivered", color: "#22c55e" }, ORG);
    expect(updated).toMatchObject({ name: "Delivered", slug: "completed", color: "#22c55e" });
    await expect(service.update("co", { name: "IN REVIEW" }, ORG)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.update("x", { name: "Mine" }, ORG)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("reorder writes the new order and rejects a partial or foreign list", async () => {
    await service.reorder({ ids: ["ip", "ns", "ir", "co", "ca"] }, ORG);
    expect(names()).toEqual(["In Progress", "Not Started", "In Review", "Completed", "Cancelled"]);
    for (const ids of [["ip"], ["ip", "ip", "ir", "co", "ca"], ["ip", "ns", "ir", "co", "x"]]) {
      await expect(service.reorder({ ids }, ORG)).rejects.toThrow("Send every status once");
    }
  });

  it("remove moves the status's projects to another status, then deletes it", async () => {
    const design = await service.create({ name: "Design" }, ORG);
    projects.push(
      { id: "p1", organizationId: ORG, status: "design" },
      { id: "p2", organizationId: ORG, status: "completed" },
      { id: "p3", organizationId: "org-2", status: "design" },
    );

    await service.remove(design.id, "ip", ORG);

    expect(projects.map((p) => p.status)).toEqual(["in_progress", "completed", "design"]);
    expect(names()).not.toContain("Design");
    expect(db.locks[0]).toContain("pg_advisory_xact_lock");
  });

  it("remove refuses a built-in status", async () => {
    await expect(service.remove("co", "ip", ORG)).rejects.toThrow("Built-in statuses can't be deleted");
    expect(names()).toContain("Completed");
  });

  it("remove rejects a target that is itself, missing, or another workspace's, re-checking under the lock", async () => {
    const design = await service.create({ name: "Design" }, ORG);
    for (const moveTo of [design.id, "", "x"]) {
      await expect(service.remove(design.id, moveTo, ORG)).rejects.toBeInstanceOf(BadRequestException);
    }
    const build = await service.create({ name: "Build" }, ORG);
    // Another admin deletes the target just before this transaction gets the lock.
    db.beforeTransaction = () => statuses.splice(statuses.findIndex((s) => s.id === build.id), 1);
    await expect(service.remove(design.id, build.id, ORG)).rejects.toBeInstanceOf(BadRequestException);
    expect(names()).toContain("Design");
  });
});
