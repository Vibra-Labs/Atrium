import { describe, it, expect, beforeEach, beforeAll, afterAll } from "bun:test";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { TimeEntriesService } from "./time-entries.service";

let service: TimeEntriesService;
let prisma: PrismaService;
let orgId: string;
let userId: string;
let projectId: string;
let memberId: string;

beforeAll(async () => {
  const mod = await Test.createTestingModule({
    providers: [TimeEntriesService, PrismaService],
  }).compile();
  service = mod.get(TimeEntriesService);
  prisma = mod.get(PrismaService);
});

beforeEach(async () => {
  // Clean slate
  await prisma.timeEntry.deleteMany({ where: {} });
  // Reuse fixtures pattern from clients.service.spec.ts: create org, user, project
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { id: `te-org-${stamp}`, name: `te-org-${stamp}`, slug: `te-${stamp}` } });
  orgId = org.id;
  const user = await prisma.user.create({ data: { id: `te-user-${stamp}`, name: "T", email: `t-${stamp}@x.com`, emailVerified: true } });
  userId = user.id;
  const member = await prisma.member.create({ data: { id: `te-member-${stamp}`, organizationId: orgId, userId, role: "admin", hourlyRateCents: 5000 } });
  memberId = member.id;
  const project = await prisma.project.create({ data: { name: "P", organizationId: orgId, hourlyRateCents: null } });
  projectId = project.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("TimeEntriesService.start/stop", () => {
  it("start creates a running entry", async () => {
    const entry = await service.start(userId, orgId, { projectId });
    expect(entry.endedAt).toBeNull();
    expect(entry.durationSec).toBeNull();
    expect(entry.hourlyRateCents).toBe(5000);
  });

  it("start auto-stops a previous running entry", async () => {
    const first = await service.start(userId, orgId, { projectId });
    const second = await service.start(userId, orgId, { projectId });
    const reloaded = await prisma.timeEntry.findUnique({ where: { id: first.id } });
    expect(reloaded?.endedAt).not.toBeNull();
    expect(reloaded?.durationSec).toBeGreaterThanOrEqual(0);
    expect(second.endedAt).toBeNull();
  });

  it("stop sets endedAt and durationSec", async () => {
    const started = await service.start(userId, orgId, { projectId });
    await new Promise((r) => setTimeout(r, 1100));
    const stopped = await service.stop(userId, orgId);
    expect(stopped.id).toBe(started.id);
    expect(stopped.endedAt).not.toBeNull();
    expect(stopped.durationSec).toBeGreaterThanOrEqual(1);
  });

  it("stop returns 404 when no running entry", async () => {
    await expect(service.stop(userId, orgId)).rejects.toThrow();
  });

  it("project rate overrides member rate at start time", async () => {
    await prisma.project.update({ where: { id: projectId }, data: { hourlyRateCents: 12000 } });
    const entry = await service.start(userId, orgId, { projectId });
    expect(entry.hourlyRateCents).toBe(12000);
  });
});
