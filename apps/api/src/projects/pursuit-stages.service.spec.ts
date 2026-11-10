import { describe, expect, it, beforeEach } from "bun:test";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { PursuitStagesService } from "./pursuit-stages.service";

interface Stage {
  id: string;
  organizationId: string;
  pipeline: string;
  name: string;
  slug: string;
  order: number;
}
interface Pursuit {
  projectId: string;
  organizationId: string;
  isBid: boolean;
  stage: string;
  outcome: string;
}
type Where = Record<string, unknown>;

const matches = (row: object, where: Where = {}): boolean =>
  Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v);
const byOrder = (a: Stage, b: Stage): number => a.pipeline.localeCompare(b.pipeline) || a.order - b.order;

/** Just enough of Prisma for the service: two tables kept in arrays. */
function fakeDb(stages: Stage[], pursuits: Pursuit[]) {
  let next = 100;
  const db = {
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
      updateMany: async ({ where, data }: { where: Where; data: Partial<Pursuit> }) => {
        const rows = pursuits.filter((p) => matches(p, where));
        rows.forEach((p) => Object.assign(p, data));
        return { count: rows.length };
      },
    },
    $transaction: async (arg: unknown) =>
      typeof arg === "function" ? (arg as (tx: unknown) => Promise<unknown>)(db) : Promise.all(arg as Promise<unknown>[]),
  };
  return db;
}

const ORG = "org-1";
function defaults(pipeline: string, prefix: string): Stage[] {
  return [
    { id: `${prefix}1`, organizationId: ORG, pipeline, name: "Lead", slug: "found", order: 0 },
    { id: `${prefix}2`, organizationId: ORG, pipeline, name: "Proposal sent", slug: "proposal_sent", order: 1 },
    { id: `${prefix}3`, organizationId: ORG, pipeline, name: "Waiting on decision", slug: "waiting", order: 2 },
  ];
}

describe("PursuitStagesService", () => {
  let stages: Stage[];
  let pursuits: Pursuit[];
  let service: PursuitStagesService;

  beforeEach(() => {
    stages = [
      ...defaults("bid", "b"),
      ...defaults("commercial", "c"),
      { id: "x1", organizationId: "org-2", pipeline: "commercial", name: "Theirs", slug: "theirs", order: 0 },
    ];
    pursuits = [];
    service = new PursuitStagesService(fakeDb(stages, pursuits) as never);
  });

  const names = async (pipeline: string): Promise<string[]> =>
    (await service.findAll(ORG)).filter((s) => s.pipeline === pipeline).map((s) => s.name);

  it("findAll lists both pipelines of the workspace in order", async () => {
    const all = await service.findAll(ORG);
    expect(all.map((s) => s.id)).toEqual(["b1", "b2", "b3", "c1", "c2", "c3"]);
  });

  it("create makes a slug from the name and appends it to its pipeline", async () => {
    const stage = await service.create({ pipeline: "commercial", name: "  Verbal yes " }, ORG);
    expect(stage).toMatchObject({ pipeline: "commercial", name: "Verbal yes", slug: "verbal_yes", order: 3 });
    expect(await names("bid")).not.toContain("Verbal yes");
  });

  it("create adds a suffix when the slug is taken in the same pipeline only", async () => {
    await service.create({ pipeline: "commercial", name: "Verbal yes" }, ORG);
    const again = await service.create({ pipeline: "commercial", name: "Verbal-yes!" }, ORG);
    expect(again.slug).toBe("verbal_yes_2");
    const bid = await service.create({ pipeline: "bid", name: "Verbal yes" }, ORG);
    expect(bid.slug).toBe("verbal_yes");
  });

  it("create rejects an 11th stage in a pipeline", async () => {
    for (let i = 0; i < 7; i++) await service.create({ pipeline: "bid", name: `Step ${i}` }, ORG);
    await expect(service.create({ pipeline: "bid", name: "One more" }, ORG)).rejects.toThrow(
      "A pipeline can have at most 10 stages",
    );
    // The other pipeline still has room.
    await service.create({ pipeline: "commercial", name: "One more" }, ORG);
  });

  it("create and rename reject a duplicate name in the same pipeline, case-insensitively", async () => {
    await expect(service.create({ pipeline: "bid", name: "proposal SENT" }, ORG)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.rename("b1", { name: "waiting on decision" }, ORG)).rejects.toBeInstanceOf(ConflictException);
  });

  it("create and rename reject a blank name", async () => {
    await expect(service.create({ pipeline: "bid", name: "  " }, ORG)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.rename("b1", { name: "" }, ORG)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rename keeps the slug", async () => {
    const stage = await service.rename("c1", { name: "Intro call" }, ORG);
    expect(stage).toMatchObject({ name: "Intro call", slug: "found" });
    // Renaming to its own name in different case is fine.
    await service.rename("c1", { name: "INTRO CALL" }, ORG);
  });

  it("rename of another workspace's stage is not found", async () => {
    await expect(service.rename("x1", { name: "Mine now" }, ORG)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("reorder writes the new order for one pipeline", async () => {
    await service.reorder({ pipeline: "commercial", ids: ["c3", "c1", "c2"] }, ORG);
    expect(await names("commercial")).toEqual(["Waiting on decision", "Lead", "Proposal sent"]);
    expect(await names("bid")).toEqual(["Lead", "Proposal sent", "Waiting on decision"]);
  });

  it("reorder rejects a missing id, a duplicate, a foreign id, or an id from the other pipeline", async () => {
    for (const ids of [
      ["c1", "c2"],
      ["c1", "c1", "c2"],
      ["c1", "c2", "x1"],
      ["c1", "c2", "b3"],
    ]) {
      await expect(service.reorder({ pipeline: "commercial", ids }, ORG)).rejects.toThrow("Send every stage once");
    }
  });

  it("remove moves every pursuit in that pipeline on the slug, any outcome, then deletes", async () => {
    pursuits.push(
      { projectId: "p1", organizationId: ORG, isBid: false, stage: "waiting", outcome: "open" },
      { projectId: "p2", organizationId: ORG, isBid: false, stage: "waiting", outcome: "won" },
      { projectId: "p3", organizationId: ORG, isBid: true, stage: "waiting", outcome: "open" },
      { projectId: "p4", organizationId: "org-2", isBid: false, stage: "waiting", outcome: "open" },
    );

    await service.remove("c3", "c2", ORG);

    expect(pursuits.map((p) => p.stage)).toEqual(["proposal_sent", "proposal_sent", "waiting", "waiting"]);
    expect(await names("commercial")).toEqual(["Lead", "Proposal sent"]);
  });

  it("remove rejects moveTo equal to the stage, missing, in the other pipeline, or from another workspace", async () => {
    for (const moveTo of ["c3", "", "b2", "x1", "nope"]) {
      await expect(service.remove("c3", moveTo, ORG)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(await names("commercial")).toHaveLength(3);
  });

  it("remove rejects the last stage in a pipeline", async () => {
    await service.remove("b3", "b1", ORG);
    await service.remove("b2", "b1", ORG);
    await expect(service.remove("b1", "c1", ORG)).rejects.toThrow("A pipeline needs at least one stage");
  });

  it("firstSlug follows the current order and find is scoped to the pipeline", async () => {
    await service.reorder({ pipeline: "bid", ids: ["b2", "b1", "b3"] }, ORG);
    expect(await service.firstSlug(ORG, "bid")).toBe("proposal_sent");
    expect(await service.firstSlug(ORG, "commercial")).toBe("found");
    const verbal = await service.create({ pipeline: "commercial", name: "Verbal yes" }, ORG);
    expect(await service.find(ORG, "commercial", "verbal_yes")).toMatchObject({ id: verbal.id });
    expect(await service.find(ORG, "bid", "verbal_yes")).toBeNull();
  });
});
