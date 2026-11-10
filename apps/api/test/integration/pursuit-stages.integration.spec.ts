import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { PursuitStagesService } from "../../src/projects/pursuit-stages.service";

let prisma: PrismaService;
let stages: PursuitStagesService;
const orgIds: string[] = [];

beforeAll(async () => {
  assertDisposableDatabase();
  prisma = new PrismaService();
  await prisma.$connect();
  stages = new PursuitStagesService(prisma);
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch((e: unknown) => console.error(e));
  await prisma?.$disconnect();
});

async function org(): Promise<string> {
  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const id = (await prisma.organization.create({ data: { id: `ps-org-${s}`, name: `ps-${s}`, slug: `ps-${s}` } })).id;
  orgIds.push(id);
  return id;
}

async function names(orgId: string, pipeline: string): Promise<string[]> {
  return (await prisma.pursuitStage.findMany({ where: { organizationId: orgId, pipeline }, orderBy: { order: "asc" } })).map(
    (s) => s.name,
  );
}

async function pursuit(orgId: string, isBid: boolean, stage: string, outcome: string): Promise<string> {
  const project = await prisma.project.create({
    data: { name: `p-${stage}`, organizationId: orgId, pursuit: { create: { organizationId: orgId, isBid, stage, outcome } } },
  });
  return project.id;
}

describe("PursuitStagesService against Postgres", () => {
  it("seedMissing fills only pipelines with no stages, once", async () => {
    const fresh = await org();
    const edited = await org();
    await prisma.pursuitStage.create({
      data: { organizationId: edited, pipeline: "commercial", name: "Intro call", slug: "intro_call", order: 0 },
    });

    await stages.seedMissing();
    await stages.seedMissing();

    const defaults = ["Lead", "Proposal sent", "Waiting on decision"];
    expect(await names(fresh, "bid")).toEqual(defaults);
    expect(await names(fresh, "commercial")).toEqual(defaults);
    expect(await names(edited, "bid")).toEqual(defaults);
    expect(await names(edited, "commercial")).toEqual(["Intro call"]);
  });

  // remove() also takes a Postgres advisory lock here, so this checks that SQL runs.
  it("remove moves won and open contracts in that pipeline only", async () => {
    const orgId = await org();
    await stages.seedMissing();
    const all = await stages.findAll(orgId);
    const id = (pipeline: string, slug: string): string => all.find((s) => s.pipeline === pipeline && s.slug === slug)!.id;
    const open = await pursuit(orgId, false, "waiting", "open");
    const won = await pursuit(orgId, false, "waiting", "won");
    const bid = await pursuit(orgId, true, "waiting", "open");

    await stages.remove(id("commercial", "waiting"), id("commercial", "proposal_sent"), orgId);

    const stageOf = async (projectId: string): Promise<string> =>
      (await prisma.projectPursuit.findUniqueOrThrow({ where: { projectId } })).stage;
    expect(await stageOf(open)).toBe("proposal_sent");
    expect(await stageOf(won)).toBe("proposal_sent");
    expect(await stageOf(bid)).toBe("waiting");
    expect(await names(orgId, "commercial")).toEqual(["Lead", "Proposal sent"]);
  });
});
