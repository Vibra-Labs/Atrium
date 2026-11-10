import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ContactSyncService } from "../../src/contact-sync/contact-sync.service";
import { PursuitStagesService } from "../../src/projects/pursuit-stages.service";
import { ProjectsService } from "../../src/projects/projects.service";
import { assertProjectAccess } from "../../src/common/helpers/assert-project-access";

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

interface Seed {
  orgId: string;
  clientId: string;
  signedId: string;
  openId: string;
  lostId: string;
}

/** A client on a signed project, and (bad data) on an open and a lost potential contract too. */
async function seed(): Promise<Seed> {
  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgId = (await prisma.organization.create({ data: { id: `pc-org-${s}`, name: `pc-${s}`, slug: `pc-${s}` } })).id;
  orgIds.push(orgId);
  const clientId = `pc-client-${s}`;
  userIds.push(clientId);
  await prisma.user.create({ data: { id: clientId, name: "Cleo", email: `cleo-${s}@x.com`, emailVerified: true } });
  await prisma.member.create({ data: { id: `pc-m-${s}`, organizationId: orgId, userId: clientId, role: "member" } });

  const signedId = (await prisma.project.create({ data: { name: "Signed", organizationId: orgId } })).id;
  const openId = (
    await prisma.project.create({
      data: { name: "Open bid", organizationId: orgId, pursuit: { create: { organizationId: orgId } } },
    })
  ).id;
  const lostId = (
    await prisma.project.create({
      data: { name: "Lost bid", organizationId: orgId, pursuit: { create: { organizationId: orgId, outcome: "lost" } } },
    })
  ).id;
  await prisma.projectClient.createMany({
    data: [signedId, openId, lostId].map((projectId) => ({ projectId, userId: clientId })),
  });
  return { orgId, clientId, signedId, openId, lostId };
}

describe("potential contracts are unreachable from the portal", () => {
  it("findByClient does not list an open potential contract", async () => {
    const d = await seed();
    const res = await projects.findByClient(d.clientId, d.orgId, {});
    const ids: string[] = res.data.map((p: { id: string }) => p.id);
    expect(ids).toContain(d.signedId);
    expect(ids).not.toContain(d.openId);
    expect(ids).not.toContain(d.lostId);
  });

  it("findOneByClient rejects an open potential contract", async () => {
    const d = await seed();
    await expect(projects.findOneByClient(d.openId, d.clientId, d.orgId)).rejects.toThrow(NotFoundException);
  });

  it("findOneByClient still serves a won potential contract", async () => {
    const d = await seed();
    await prisma.projectPursuit.update({ where: { projectId: d.openId }, data: { outcome: "won" } });
    const project = await projects.findOneByClient(d.openId, d.clientId, d.orgId);
    expect(project.id).toBe(d.openId);
  });

  it("assertProjectAccess rejects a client on a lost potential contract", async () => {
    const d = await seed();
    await expect(assertProjectAccess(prisma, d.lostId, d.clientId, "member", d.orgId)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(assertProjectAccess(prisma, d.openId, d.clientId, "member")).rejects.toThrow(ForbiddenException);
    await assertProjectAccess(prisma, d.signedId, d.clientId, "member", d.orgId);
  });

  it("update refuses clientUserIds on an open potential contract", async () => {
    const d = await seed();
    await expect(projects.update(d.openId, { clientUserIds: [d.clientId] }, d.orgId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("duplicate refuses to copy clients from an unsigned project", async () => {
    const d = await seed();
    await expect(
      projects.duplicate(d.openId, { name: "Copy", includeClients: true }, d.orgId),
    ).rejects.toThrow(BadRequestException);
  });
});
