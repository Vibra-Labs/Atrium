import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Test } from "@nestjs/testing";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ContactSyncService } from "../../src/contact-sync/contact-sync.service";
import { PursuitStagesService } from "../../src/projects/pursuit-stages.service";
import { ProjectsService } from "../../src/projects/projects.service";

let prisma: PrismaService;
let projects: ProjectsService;
const orgIds: string[] = [];
const userIds: string[] = [];

beforeAll(async () => {
  assertDisposableDatabase();
  const mod = await Test.createTestingModule({
    providers: [ContactSyncService, ProjectsService, PursuitStagesService, PrismaService],
  }).compile();
  prisma = mod.get(PrismaService);
  projects = mod.get(ProjectsService);
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch((e: unknown) => console.error(e));
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch((e: unknown) => console.error(e));
  await prisma?.$disconnect();
});

/** A new client who just accepted an invite, with access promised on one won and one open potential contract. */
async function seed(): Promise<{ orgId: string; userId: string; email: string; wonId: string; openId: string }> {
  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgId = (await prisma.organization.create({ data: { id: `pa-org-${s}`, name: `pa-${s}`, slug: `pa-${s}` } })).id;
  orgIds.push(orgId);
  const userId = `pa-client-${s}`;
  const email = `lee-${s}@x.com`;
  userIds.push(userId);
  await prisma.user.create({ data: { id: userId, name: "Lee", email, emailVerified: true } });
  await prisma.member.create({ data: { id: `pa-m-${s}`, organizationId: orgId, userId, role: "member" } });
  const make = (outcome: string) =>
    prisma.project.create({
      data: { name: outcome, organizationId: orgId, pursuit: { create: { organizationId: orgId, outcome } } },
    });
  const wonId = (await make("won")).id;
  const openId = (await make("open")).id;
  await prisma.pendingProjectAccess.createMany({
    data: [wonId, openId].map((projectId) => ({ organizationId: orgId, projectId, email: email.toLowerCase() })),
  });
  return { orgId, userId, email, wonId, openId };
}

describe("grantPendingAccess", () => {
  it("adds the client to the won project and clears the row", async () => {
    const d = await seed();
    const applied: number = await projects.grantPendingAccess(d.orgId, d.userId, d.email.toUpperCase());
    expect(applied).toBe(1);
    const client = await prisma.projectClient.findFirst({ where: { projectId: d.wonId, userId: d.userId } });
    expect(client).not.toBeNull();
    expect(await prisma.pendingProjectAccess.count({ where: { projectId: d.wonId } })).toBe(0);
    // The contact is linked to the project too.
    const link = await prisma.projectContact.findFirst({ where: { projectId: d.wonId, contact: { userId: d.userId } } });
    expect(link).not.toBeNull();
  });

  it("ignores rows for projects that aren't won", async () => {
    const d = await seed();
    await projects.grantPendingAccess(d.orgId, d.userId, d.email);
    expect(await prisma.projectClient.count({ where: { projectId: d.openId } })).toBe(0);
    expect(await prisma.pendingProjectAccess.count({ where: { projectId: d.openId } })).toBe(1);
  });

  it("drops access promised longer ago than an invite lasts", async () => {
    const d = await seed();
    const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await prisma.pendingProjectAccess.updateMany({ where: { projectId: d.wonId }, data: { createdAt: old } });
    expect(await projects.grantPendingAccess(d.orgId, d.userId, d.email)).toBe(0);
    expect(await prisma.projectClient.count({ where: { projectId: d.wonId } })).toBe(0);
    expect(await prisma.pendingProjectAccess.count({ where: { projectId: d.wonId } })).toBe(0);
  });

  it("ignores access to a project that has since been archived", async () => {
    const d = await seed();
    await prisma.project.update({ where: { id: d.wonId }, data: { archivedAt: new Date() } });
    expect(await projects.grantPendingAccess(d.orgId, d.userId, d.email)).toBe(0);
    expect(await prisma.projectClient.count({ where: { projectId: d.wonId } })).toBe(0);
  });

  it("does nothing for an email with no pending access", async () => {
    const d = await seed();
    expect(await projects.grantPendingAccess(d.orgId, d.userId, "someone@else.com")).toBe(0);
  });
});
