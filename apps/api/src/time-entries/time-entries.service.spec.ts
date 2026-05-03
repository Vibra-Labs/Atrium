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

describe("TimeEntriesService.create/update/delete", () => {
  it("create computes durationSec from start/end", async () => {
    const start = new Date("2026-05-01T10:00:00Z");
    const end = new Date("2026-05-01T11:30:00Z");
    const entry = await service.create(userId, orgId, {
      projectId,
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
      description: "manual",
    });
    expect(entry.durationSec).toBe(5400);
    expect(entry.hourlyRateCents).toBe(5000);
  });

  it("create rejects when end <= start", async () => {
    const start = new Date("2026-05-01T10:00:00Z");
    const end = new Date("2026-05-01T09:00:00Z");
    await expect(
      service.create(userId, orgId, { projectId, startedAt: start.toISOString(), endedAt: end.toISOString() }),
    ).rejects.toThrow();
  });

  it("update on invoiced entry returns 409", async () => {
    const entry = await service.create(userId, orgId, {
      projectId,
      startedAt: new Date(Date.now() - 3600_000).toISOString(),
      endedAt: new Date().toISOString(),
    });
    // Fake an invoice link
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: orgId,
        invoiceNumber: `INV-${Date.now()}`,
        status: "draft",
        dueDate: new Date(Date.now() + 86400000),
      },
    });
    const lineItem = await prisma.invoiceLineItem.create({
      data: { invoiceId: invoice.id, description: "x", quantity: 1, unitPrice: 5000 },
    });
    await prisma.timeEntry.update({ where: { id: entry.id }, data: { invoiceLineItemId: lineItem.id } });

    await expect(service.update(entry.id, userId, orgId, { description: "edit" })).rejects.toThrow(/locked/i);
    await expect(service.delete(entry.id, userId, orgId)).rejects.toThrow(/locked/i);
  });

  it("delete unlocked entry succeeds", async () => {
    const entry = await service.create(userId, orgId, {
      projectId,
      startedAt: new Date(Date.now() - 3600_000).toISOString(),
      endedAt: new Date().toISOString(),
    });
    await service.delete(entry.id, userId, orgId);
    const reloaded = await prisma.timeEntry.findUnique({ where: { id: entry.id } });
    expect(reloaded).toBeNull();
  });
});

describe("TimeEntriesService.list/report/generateInvoice", () => {
  it("list filters by projectId and date range", async () => {
    const e1 = await service.create(userId, orgId, {
      projectId,
      startedAt: "2026-04-01T09:00:00Z",
      endedAt: "2026-04-01T10:00:00Z",
    });
    const otherProject = await prisma.project.create({ data: { name: "P2", organizationId: orgId } });
    await service.create(userId, orgId, {
      projectId: otherProject.id,
      startedAt: "2026-04-01T11:00:00Z",
      endedAt: "2026-04-01T12:00:00Z",
    });
    const res = await service.list(orgId, { projectId });
    expect(res.data.length).toBe(1);
    expect(res.data[0].id).toBe(e1.id);
  });

  it("report aggregates billable seconds and value cents", async () => {
    await service.create(userId, orgId, {
      projectId,
      startedAt: "2026-04-01T09:00:00Z",
      endedAt: "2026-04-01T10:00:00Z",
      billable: true,
    });
    await service.create(userId, orgId, {
      projectId,
      startedAt: "2026-04-01T10:00:00Z",
      endedAt: "2026-04-01T10:30:00Z",
      billable: false,
    });
    const r = await service.report(orgId, {});
    expect(r.totals.seconds).toBe(5400);
    expect(r.totals.billableSeconds).toBe(3600);
    expect(r.totals.valueCents).toBe(5000); // 1h * $50
  });

  it("generateInvoice creates draft, snapshots rate, marks entries", async () => {
    const e1 = await service.create(userId, orgId, {
      projectId,
      startedAt: "2026-04-01T09:00:00Z",
      endedAt: "2026-04-01T10:00:00Z",
    });
    const e2 = await service.create(userId, orgId, {
      projectId,
      startedAt: "2026-04-02T09:00:00Z",
      endedAt: "2026-04-02T09:30:00Z",
    });
    const { invoiceId } = await service.generateInvoice(userId, orgId, { projectId });
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true },
    });
    expect(invoice?.status).toBe("draft");
    expect(invoice?.lineItems.length).toBe(2);
    const total = invoice!.lineItems.reduce((s, li) => s + li.unitPrice * li.quantity, 0);
    expect(total).toBe(5000 + 2500);
    const reloaded = await prisma.timeEntry.findMany({ where: { id: { in: [e1.id, e2.id] } } });
    expect(reloaded.every((e) => e.invoiceLineItemId !== null)).toBe(true);
  });

  it("generateInvoice rejects when no eligible entries", async () => {
    await expect(service.generateInvoice(userId, orgId, { projectId })).rejects.toThrow();
  });

  it("generateInvoice skips already-invoiced entries", async () => {
    await service.create(userId, orgId, {
      projectId,
      startedAt: "2026-04-01T09:00:00Z",
      endedAt: "2026-04-01T10:00:00Z",
    });
    await service.generateInvoice(userId, orgId, { projectId });
    await expect(service.generateInvoice(userId, orgId, { projectId })).rejects.toThrow();
  });
});
