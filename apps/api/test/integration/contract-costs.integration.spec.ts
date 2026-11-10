import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ContactSyncService } from "../../src/contact-sync/contact-sync.service";
import { PursuitStagesService } from "../../src/projects/pursuit-stages.service";
import { ProjectsService } from "../../src/projects/projects.service";
import { CostsService } from "../../src/projects/costs.service";

let prisma: PrismaService;
let projects: ProjectsService;
let costs: CostsService;
const orgIds: string[] = [];
const userIds: string[] = [];

beforeAll(async () => {
  assertDisposableDatabase();
  const mod = await Test.createTestingModule({
    providers: [ContactSyncService, ProjectsService, PursuitStagesService, CostsService, PrismaService],
  }).compile();
  prisma = mod.get(PrismaService);
  projects = mod.get(ProjectsService);
  costs = mod.get(CostsService);
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch((e: unknown) => console.error(e));
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch((e: unknown) => console.error(e));
  await prisma?.$disconnect();
});

interface Seed {
  orgId: string;
  userId: string;
  projectId: string;
}

/** An open potential contract worth $10,000 with 1h30m logged and a timer still running. */
async function seed(): Promise<Seed> {
  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgId = (await prisma.organization.create({ data: { id: `cc-org-${s}`, name: `cc-${s}`, slug: `cc-${s}` } })).id;
  orgIds.push(orgId);
  const userId = `cc-user-${s}`;
  userIds.push(userId);
  await prisma.user.create({ data: { id: userId, name: "Cleo", email: `cleo-${s}@x.com`, emailVerified: true } });
  await prisma.member.create({ data: { id: `cc-m-${s}`, organizationId: orgId, userId, role: "member" } });
  const projectId = (
    await prisma.project.create({
      data: {
        name: "Bid",
        organizationId: orgId,
        pursuit: { create: { organizationId: orgId, valueCents: 1000000 } },
      },
    })
  ).id;
  const start = new Date("2026-11-01T10:00:00Z");
  await prisma.timeEntry.createMany({
    data: [
      { organizationId: orgId, projectId, userId, startedAt: start, endedAt: start, durationSec: 3600 },
      { organizationId: orgId, projectId, userId, startedAt: start, endedAt: start, durationSec: 1800, billable: false },
      { organizationId: orgId, projectId, userId, startedAt: new Date() },
    ],
  });
  return { orgId, userId, projectId };
}

describe("contract costs", () => {
  it("prices finished tracked time, billable or not, plus cost lines", async () => {
    const d = await seed();
    await costs.update(d.projectId, { laborRateCents: 4000 }, d.orgId);
    const result = await costs.addLine(d.projectId, { label: "Materials", amountCents: 300000 }, d.orgId);
    expect(result.trackedSeconds).toBe(5400);
    // 1.5h × $40 = $60, plus $3,000 → $3,060 cost on $10,000.
    expect(result.summary).toEqual({
      detailed: true,
      laborCents: 6000,
      costCents: 306000,
      profitCents: 694000,
      marginPct: 69,
    });
  });

  it("stays editable after a win, and is locked after a loss until reopened", async () => {
    const d = await seed();
    await prisma.projectPursuit.update({ where: { projectId: d.projectId }, data: { outcome: "won" } });
    expect((await costs.update(d.projectId, { costCents: 200000 }, d.orgId)).summary.profitCents).toBe(800000);

    await prisma.projectPursuit.update({ where: { projectId: d.projectId }, data: { outcome: "lost" } });
    await expect(costs.update(d.projectId, { costCents: 1 }, d.orgId)).rejects.toThrow(BadRequestException);

    await prisma.projectPursuit.update({ where: { projectId: d.projectId }, data: { outcome: "open" } });
    expect((await costs.update(d.projectId, { costCents: 1 }, d.orgId)).costCents).toBe(1);
  });

  it("a breakdown replaces the typed cost, so removing every line leaves it blank, not the old number", async () => {
    const d = await seed();
    await costs.update(d.projectId, { costCents: 500000 }, d.orgId);
    const added = await costs.addLine(d.projectId, { label: "Paint", amountCents: 100 }, d.orgId);
    expect(added.summary.costCents).toBe(100);
    const removed = await costs.removeLine(d.projectId, added.lines[0].id, d.orgId);
    expect(removed.summary).toMatchObject({ detailed: false, costCents: null });
  });

  it("never reaches the client portal", async () => {
    const d = await seed();
    await prisma.projectPursuit.update({ where: { projectId: d.projectId }, data: { outcome: "won" } });
    await prisma.projectClient.create({ data: { projectId: d.projectId, userId: d.userId } });
    await costs.update(d.projectId, { costCents: 123456 }, d.orgId);
    await costs.addLine(d.projectId, { label: "Secret supplier", amountCents: 999 }, d.orgId);

    const one = JSON.stringify(await projects.findOneByClient(d.projectId, d.userId, d.orgId));
    const list = JSON.stringify(await projects.findByClient(d.userId, d.orgId, {}));
    for (const body of [one, list]) {
      expect(body).not.toContain("123456");
      expect(body).not.toContain("Secret supplier");
      expect(body).not.toContain("costCents");
    }
  });
});
