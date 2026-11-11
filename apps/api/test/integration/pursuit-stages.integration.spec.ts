import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { PursuitStagesService, seedDefaultPipelines } from "../../src/projects/pursuit-stages.service";

let prisma: PrismaService;
let service: PursuitStagesService;
const orgIds: string[] = [];

beforeAll(async () => {
  assertDisposableDatabase();
  prisma = new PrismaService();
  await prisma.$connect();
  service = new PursuitStagesService(prisma);
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

async function contract(
  orgId: string,
  pipelineId: string | null,
  stage: string,
  extra: { isBid?: boolean; outcome?: string } = {},
): Promise<string> {
  const project = await prisma.project.create({
    data: { name: `p-${stage}`, organizationId: orgId, pursuit: { create: { organizationId: orgId, pipelineId, stage, ...extra } } },
  });
  return project.id;
}

async function placeOf(projectId: string): Promise<[string | null, string]> {
  const p = await prisma.projectPursuit.findUniqueOrThrow({ where: { projectId } });
  return [p.pipelineId, p.stage];
}

describe("PursuitStagesService against Postgres", () => {
  it("seedMissing gives an older workspace the stock Sales pipeline and files its contracts there", async () => {
    const orgId = await org();
    const bid = await contract(orgId, null, "waiting", { isBid: true });
    const other = await contract(orgId, null, "found");

    await service.seedMissing();
    await service.seedMissing();

    const pipelines = await service.findAll(orgId);
    expect(pipelines.map((p) => [p.name, p.stages.map((s) => s.name)])).toEqual([
      ["Sales", ["Lead", "Proposal sent", "Waiting on decision"]],
    ]);
    expect(await placeOf(bid)).toEqual([pipelines[0].id, "waiting"]);
    expect(await placeOf(other)).toEqual([pipelines[0].id, "found"]);
  });

  // removeStage and removePipeline also take Postgres advisory locks here, so this checks that SQL runs.
  it("removing a stage, then a pipeline, moves its contracts (won ones too)", async () => {
    const orgId = await org();
    await seedDefaultPipelines(prisma, orgId);
    await service.createPipeline({ name: "Bids" }, orgId);
    const [commercial, bids] = await service.findAll(orgId);
    const gov = await service.createStage({ pipelineId: bids.id, name: "Questions submitted" }, orgId);
    const open = await contract(orgId, commercial.id, "waiting");
    const won = await contract(orgId, bids.id, gov.slug, { outcome: "won" });
    const bidWaiting = await contract(orgId, bids.id, "waiting");

    await service.removeStage(commercial.stages[2].id, commercial.stages[1].id, orgId);
    expect(await placeOf(open)).toEqual([commercial.id, "proposal_sent"]);
    expect(await placeOf(bidWaiting)).toEqual([bids.id, "waiting"]);

    await service.removePipeline(bids.id, commercial.id, orgId);
    expect(await placeOf(won)).toEqual([commercial.id, "found"]);
    expect(await placeOf(bidWaiting)).toEqual([commercial.id, "found"]);
    expect((await service.findAll(orgId)).map((p) => p.name)).toEqual(["Sales"]);
    expect(await prisma.pursuitStage.count({ where: { pipelineId: bids.id } })).toBe(0);
  });
});
