import { describe, expect, it, beforeEach } from "bun:test";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { PursuitStagesService } from "./pursuit-stages.service";

interface Pipeline {
  id: string;
  organizationId: string;
  name: string;
  order: number;
}
interface Stage {
  id: string;
  organizationId: string;
  pipelineId: string;
  name: string;
  slug: string;
  order: number;
}
interface Pursuit {
  projectId: string;
  organizationId: string;
  pipelineId: string | null;
  isBid: boolean;
  stage: string;
  outcome: string;
}
type Where = Record<string, unknown>;

const ORG = "org-1";

/** Equality, plus `{ in: [...] }`, which is all the service's filters use. */
const matches = (row: object, where: Where = {}): boolean =>
  Object.entries(where).every(([k, v]) => {
    const value: unknown = (row as Record<string, unknown>)[k];
    if (v && typeof v === "object" && "in" in v) return (v as { in: unknown[] }).in.includes(value);
    return value === v;
  });
const byOrder = <T extends { order: number }>(a: T, b: T): number => a.order - b.order;

/** Just enough of Prisma for the service: three tables kept in arrays. */
function fakeDb(pipelines: Pipeline[], stages: Stage[], pursuits: Pursuit[], orgIds: string[] = [ORG]) {
  let next = 100;
  const withStages = (p: Pipeline) => ({ ...p, stages: stages.filter((s) => s.pipelineId === p.id).sort(byOrder) });
  const db = {
    /** Runs when a transaction starts, standing in for another admin's commit that lands first. */
    beforeTransaction: null as null | (() => void),
    locks: [] as string[],
    organization: {
      findMany: async () => orgIds.filter((id) => !pipelines.some((p) => p.organizationId === id)).map((id) => ({ id })),
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      db.locks.push(`${strings.join("?")}|${values.join(",")}`);
      return 1;
    },
    pursuitPipeline: {
      findMany: async ({ where, include }: { where: Where; include?: unknown }) => {
        const rows = pipelines.filter((p) => matches(p, where)).sort(byOrder);
        return include ? rows.map(withStages) : rows;
      },
      findFirst: async ({ where, include }: { where: Where; include?: unknown }) => {
        const row = pipelines.filter((p) => matches(p, where)).sort(byOrder)[0];
        return row ? (include ? withStages(row) : row) : null;
      },
      create: async ({ data }: { data: Omit<Pipeline, "id"> & { stages?: { create: Omit<Stage, "id" | "pipelineId">[] } } }) => {
        const { stages: nested, ...rest } = data;
        const row: Pipeline = { id: `p-${next++}`, ...rest };
        pipelines.push(row);
        nested?.create.forEach((s) => stages.push({ id: `s-${next++}`, pipelineId: row.id, ...s }));
        return withStages(row);
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Pipeline> }) => {
        const row = pipelines.find((p) => p.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        pipelines.splice(pipelines.findIndex((p) => p.id === where.id), 1);
        for (let i = stages.length - 1; i >= 0; i--) if (stages[i].pipelineId === where.id) stages.splice(i, 1);
      },
    },
    pursuitStage: {
      findMany: async ({ where }: { where: Where }) => stages.filter((s) => matches(s, where)).sort(byOrder),
      findFirst: async ({ where }: { where: Where }) => stages.filter((s) => matches(s, where)).sort(byOrder)[0] ?? null,
      create: async ({ data }: { data: Omit<Stage, "id"> }) => {
        const row: Stage = { id: `s-${next++}`, ...data };
        stages.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Stage> }) => {
        const row = stages.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        stages.splice(stages.findIndex((s) => s.id === where.id), 1);
      },
    },
    projectPursuit: {
      findMany: async ({ where }: { where: Where }) => pursuits.filter((p) => matches(p, where)),
      updateMany: async ({ where, data }: { where: Where; data: Partial<Pursuit> }) => {
        const rows = pursuits.filter((p) => matches(p, where));
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

function pipeline(id: string, name: string, order: number, org: string = ORG): Pipeline {
  return { id, organizationId: org, name, order };
}
function defaults(pipelineId: string, prefix: string, org: string = ORG): Stage[] {
  return [
    { id: `${prefix}1`, organizationId: org, pipelineId, name: "Lead", slug: "found", order: 0 },
    { id: `${prefix}2`, organizationId: org, pipelineId, name: "Proposal sent", slug: "proposal_sent", order: 1 },
    { id: `${prefix}3`, organizationId: org, pipelineId, name: "Waiting on decision", slug: "waiting", order: 2 },
  ];
}
function pursuit(projectId: string, pipelineId: string | null, stage: string, extra: Partial<Pursuit> = {}): Pursuit {
  return { projectId, organizationId: ORG, pipelineId, isBid: false, stage, outcome: "open", ...extra };
}

describe("PursuitStagesService", () => {
  let pipelines: Pipeline[];
  let stages: Stage[];
  let pursuits: Pursuit[];
  let db: ReturnType<typeof fakeDb>;
  let service: PursuitStagesService;

  beforeEach(() => {
    pipelines = [pipeline("com", "Commercial", 0), pipeline("bid", "Bids", 1), pipeline("x", "Theirs", 0, "org-2")];
    stages = [
      ...defaults("com", "c"),
      ...defaults("bid", "b"),
      { id: "x1", organizationId: "org-2", pipelineId: "x", name: "Theirs", slug: "theirs", order: 0 },
    ];
    pursuits = [];
    db = fakeDb(pipelines, stages, pursuits);
    service = new PursuitStagesService(db as never);
  });

  const names = (pipelineId: string): string[] =>
    stages.filter((s) => s.pipelineId === pipelineId).sort(byOrder).map((s) => s.name);
  const pipelineNames = (): string[] => pipelines.filter((p) => p.organizationId === ORG).sort(byOrder).map((p) => p.name);

  describe("pipelines", () => {
    it("findAll lists the workspace's pipelines in order, each with its stages in order", async () => {
      const all = await service.findAll(ORG);
      expect(all.map((p) => p.name)).toEqual(["Commercial", "Bids"]);
      expect(all[1].stages.map((s) => s.id)).toEqual(["b1", "b2", "b3"]);
    });

    it("createPipeline appends it with the default stages", async () => {
      const created = await service.createPipeline({ name: "  Government RFPs " }, ORG);
      expect(created).toMatchObject({ name: "Government RFPs", order: 2 });
      expect(names(created.id)).toEqual(["Lead", "Proposal sent", "Waiting on decision"]);
    });

    it("createPipeline rejects a duplicate name case-insensitively, a blank name, and an 11th pipeline", async () => {
      await expect(service.createPipeline({ name: "bids" }, ORG)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.createPipeline({ name: " " }, ORG)).rejects.toBeInstanceOf(BadRequestException);
      for (let i = 0; i < 8; i++) await service.createPipeline({ name: `P${i}` }, ORG);
      await expect(service.createPipeline({ name: "One more" }, ORG)).rejects.toThrow(
        "A workspace can have at most 10 pipelines",
      );
    });

    it("renamePipeline renames, rejects a clash, and can't reach another workspace", async () => {
      await service.renamePipeline("bid", { name: "Government" }, ORG);
      expect(pipelineNames()).toEqual(["Commercial", "Government"]);
      await expect(service.renamePipeline("bid", { name: "COMMERCIAL" }, ORG)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.renamePipeline("x", { name: "Mine" }, ORG)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("reorderPipelines writes the new order and rejects a partial or foreign list", async () => {
      await service.reorderPipelines({ ids: ["bid", "com"] }, ORG);
      expect(pipelineNames()).toEqual(["Bids", "Commercial"]);
      for (const ids of [["bid"], ["bid", "bid"], ["bid", "x"]]) {
        await expect(service.reorderPipelines({ ids }, ORG)).rejects.toThrow("Send every pipeline once");
      }
    });

    it("removePipeline moves its contracts, keeping a stage the target has, else its first stage", async () => {
      await service.createStage({ pipelineId: "bid", name: "Questions submitted" }, ORG);
      pursuits.push(
        pursuit("p1", "bid", "proposal_sent"),
        pursuit("p2", "bid", "questions_submitted", { outcome: "won" }),
        pursuit("p3", "com", "waiting"),
      );

      await service.removePipeline("bid", "com", ORG);

      expect(pursuits.map((p) => [p.pipelineId, p.stage])).toEqual([
        ["com", "proposal_sent"],
        ["com", "found"],
        ["com", "waiting"],
      ]);
      expect(pipelineNames()).toEqual(["Commercial"]);
      expect(stages.some((s) => s.pipelineId === "bid")).toBe(false);
      expect(db.locks[0]).toContain("pg_advisory_xact_lock");
    });

    it("removePipeline moves unassigned contracts too when the first pipeline goes", async () => {
      pursuits.push(pursuit("p1", null, "waiting"));
      await service.removePipeline("com", "bid", ORG);
      expect(pursuits[0]).toMatchObject({ pipelineId: "bid", stage: "waiting" });
    });

    it("removePipeline rejects the last pipeline, itself, or another workspace's target", async () => {
      for (const moveTo of ["bid", "", "x"]) {
        await expect(service.removePipeline("bid", moveTo, ORG)).rejects.toBeInstanceOf(BadRequestException);
      }
      await service.removePipeline("bid", "com", ORG);
      await expect(service.removePipeline("com", "com", ORG)).rejects.toThrow("A workspace needs at least one pipeline");
    });

    it("pipelineFor gives the asked pipeline, the first for null, and rejects an unknown id", async () => {
      expect((await service.pipelineFor(ORG, "bid")).name).toBe("Bids");
      expect((await service.pipelineFor(ORG, null)).name).toBe("Commercial");
      await expect(service.pipelineFor(ORG, "x")).rejects.toThrow("Unknown pipeline");
    });
  });

  describe("stages", () => {
    it("createStage makes a slug from the name and appends it to its pipeline", async () => {
      const stage = await service.createStage({ pipelineId: "com", name: "  Verbal yes " }, ORG);
      expect(stage).toMatchObject({ pipelineId: "com", name: "Verbal yes", slug: "verbal_yes", order: 3 });
      expect(names("bid")).not.toContain("Verbal yes");
    });

    it("createStage adds a suffix when the slug is taken in the same pipeline only", async () => {
      await service.createStage({ pipelineId: "com", name: "Verbal yes" }, ORG);
      expect((await service.createStage({ pipelineId: "com", name: "Verbal-yes!" }, ORG)).slug).toBe("verbal_yes_2");
      expect((await service.createStage({ pipelineId: "bid", name: "Verbal yes" }, ORG)).slug).toBe("verbal_yes");
    });

    it("createStage rejects an 11th stage, a duplicate name, and another workspace's pipeline", async () => {
      await expect(service.createStage({ pipelineId: "bid", name: "proposal SENT" }, ORG)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.createStage({ pipelineId: "x", name: "Mine" }, ORG)).rejects.toThrow("Unknown pipeline");
      for (let i = 0; i < 7; i++) await service.createStage({ pipelineId: "bid", name: `Step ${i}` }, ORG);
      await expect(service.createStage({ pipelineId: "bid", name: "One more" }, ORG)).rejects.toThrow(
        "A pipeline can have at most 10 stages",
      );
    });

    it("renameStage keeps the slug and rejects a clash or a blank name", async () => {
      expect(await service.renameStage("c1", { name: "Intro call" }, ORG)).toMatchObject({ name: "Intro call", slug: "found" });
      await expect(service.renameStage("c1", { name: "waiting on decision" }, ORG)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.renameStage("c1", { name: "" }, ORG)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.renameStage("x1", { name: "Mine" }, ORG)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("reorderStages writes the new order for one pipeline and rejects a partial or foreign list", async () => {
      await service.reorderStages({ pipelineId: "com", ids: ["c3", "c1", "c2"] }, ORG);
      expect(names("com")).toEqual(["Waiting on decision", "Lead", "Proposal sent"]);
      expect(names("bid")).toEqual(["Lead", "Proposal sent", "Waiting on decision"]);
      for (const ids of [["c1", "c2"], ["c1", "c1", "c2"], ["c1", "c2", "b3"]]) {
        await expect(service.reorderStages({ pipelineId: "com", ids }, ORG)).rejects.toThrow("Send every stage once");
      }
    });

    it("removeStage moves that pipeline's contracts on the slug, any outcome; the first pipeline includes unassigned ones", async () => {
      pursuits.push(
        pursuit("p1", "com", "waiting"),
        pursuit("p2", null, "waiting", { outcome: "won" }),
        pursuit("p3", "bid", "waiting"),
      );

      await service.removeStage("c3", "c2", ORG);

      expect(pursuits.map((p) => p.stage)).toEqual(["proposal_sent", "proposal_sent", "waiting"]);
      expect(names("com")).toEqual(["Lead", "Proposal sent"]);
    });

    it("removeStage rejects a bad target and the last stage, re-checking under a lock", async () => {
      for (const moveTo of ["c3", "", "b2", "x1"]) {
        await expect(service.removeStage("c3", moveTo, ORG)).rejects.toBeInstanceOf(BadRequestException);
      }
      // Another admin removes the target just before this transaction gets the lock.
      db.beforeTransaction = () => stages.splice(stages.findIndex((s) => s.id === "c2"), 1);
      await expect(service.removeStage("c3", "c2", ORG)).rejects.toBeInstanceOf(BadRequestException);
      expect(db.locks.some((l) => l.includes("pg_advisory_xact_lock"))).toBe(true);

      await service.removeStage("b3", "b1", ORG);
      await service.removeStage("b2", "b1", ORG);
      await expect(service.removeStage("b1", "c1", ORG)).rejects.toThrow("A pipeline needs at least one stage");
    });
  });

  describe("seedMissing", () => {
    it("gives a workspace with no pipelines the defaults, then files its contracts by the bid box", async () => {
      const p: Pipeline[] = [];
      const s: Stage[] = [];
      const c: Pursuit[] = [pursuit("p1", null, "waiting", { isBid: true }), pursuit("p2", null, "found")];
      const seeded = new PursuitStagesService(fakeDb(p, s, c) as never);

      await seeded.seedMissing();
      await seeded.seedMissing();

      expect(p.map((x) => [x.name, x.order])).toEqual([
        ["Commercial", 0],
        ["Bids", 1],
      ]);
      expect(s).toHaveLength(6);
      const bids = p.find((x) => x.name === "Bids")!.id;
      const commercial = p.find((x) => x.name === "Commercial")!.id;
      expect(c.map((x) => x.pipelineId)).toEqual([bids, commercial]);
    });
  });
});
