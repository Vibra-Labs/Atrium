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
  // Apply the partial unique index used by start() to prevent duplicate
  // running entries. Mirrors what the dev script and Docker entrypoints
  // do in non-test environments.
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS time_entry_one_running_per_user ON "time_entry" ("organizationId", "userId") WHERE "endedAt" IS NULL`,
  );
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

  it("update rejects taskId from a different project", async () => {
    // Entry on `projectId` with no task. Try to PATCH a taskId that belongs
    // to a different project (same org). FK alone would succeed because the
    // task exists; the service must reject it.
    const entry = await service.create(userId, orgId, {
      projectId,
      startedAt: new Date(Date.now() - 3600_000).toISOString(),
      endedAt: new Date().toISOString(),
    });
    const otherProject = await prisma.project.create({
      data: { name: "Other", organizationId: orgId },
    });
    const foreignTask = await prisma.task.create({
      data: {
        title: "Foreign",
        projectId: otherProject.id,
        organizationId: orgId,
      },
    });
    await expect(
      service.update(entry.id, userId, orgId, { taskId: foreignTask.id }),
    ).rejects.toThrow(/task not found/i);
  });

  it("update accepts a taskId that belongs to the entry's project", async () => {
    const ownTask = await prisma.task.create({
      data: { title: "Own", projectId, organizationId: orgId },
    });
    const entry = await service.create(userId, orgId, {
      projectId,
      startedAt: new Date(Date.now() - 3600_000).toISOString(),
      endedAt: new Date().toISOString(),
    });
    const updated = await service.update(entry.id, userId, orgId, {
      taskId: ownTask.id,
    });
    expect(updated.taskId).toBe(ownTask.id);
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
    const r = await service.report(orgId, {}, "admin");
    expect(r.totals.seconds).toBe(5400);
    expect(r.totals.billableSeconds).toBe(3600);
    expect(r.totals.valueCents).toBe(5000); // 1h * $50
    expect(r.byProject[0].seconds).toBe(5400);
    expect(r.byProject[0].billableSeconds).toBe(3600);
    expect(r.byProject[0].valueCents).toBe(5000);
    expect(r.byUser[0].seconds).toBe(5400);
    expect(r.byUser[0].valueCents).toBe(5000);
  });

  it("report stitches multiple projects and users (groupBy path)", async () => {
    // Two projects, two users — verifies the groupBy + name-stitch path
    // produces correct per-project and per-user buckets.
    const otherProject = await prisma.project.create({
      data: { name: "Other", organizationId: orgId, hourlyRateCents: 10000 },
    });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const otherUser = await prisma.user.create({
      data: { id: `te-u2-${stamp}`, name: "U2", email: `u2-${stamp}@x.com`, emailVerified: true },
    });
    await prisma.member.create({
      data: { id: `te-m2-${stamp}`, organizationId: orgId, userId: otherUser.id, role: "admin", hourlyRateCents: 8000 },
    });

    // Entry 1: userId on projectId — billable, 1h @ $50/hr (member rate, no project rate)
    await service.create(userId, orgId, {
      projectId,
      startedAt: "2026-04-01T09:00:00Z",
      endedAt: "2026-04-01T10:00:00Z",
      billable: true,
    });
    // Entry 2: otherUser on otherProject — billable, 2h @ $100/hr (project rate wins)
    await service.create(otherUser.id, orgId, {
      projectId: otherProject.id,
      startedAt: "2026-04-02T09:00:00Z",
      endedAt: "2026-04-02T11:00:00Z",
      billable: true,
    });

    const r = await service.report(orgId, {}, "admin");
    expect(r.totals.seconds).toBe(3600 + 7200);
    expect(r.totals.billableSeconds).toBe(3600 + 7200);
    expect(r.totals.valueCents).toBe(5000 + 20000);
    expect(r.byProject.length).toBe(2);
    expect(r.byUser.length).toBe(2);
    const otherP = r.byProject.find((p) => p.projectId === otherProject.id);
    expect(otherP?.projectName).toBe("Other");
    expect(otherP?.valueCents).toBe(20000);
    const ownP = r.byProject.find((p) => p.projectId === projectId);
    expect(ownP?.valueCents).toBe(5000);
    const otherU = r.byUser.find((u) => u.userId === otherUser.id);
    expect(otherU?.name).toBe("U2");
    expect(otherU?.valueCents).toBe(20000);
  });

  it("report omits valueCents for member role (still returns durationSec)", async () => {
    await service.create(userId, orgId, {
      projectId,
      startedAt: "2026-04-01T09:00:00Z",
      endedAt: "2026-04-01T10:00:00Z",
      billable: true,
    });
    const r = await service.report(orgId, {}, "member");
    expect(r.totals.seconds).toBe(3600);
    expect(r.totals.billableSeconds).toBe(3600);
    expect(r.totals.valueCents).toBe(0);
    expect(r.byProject[0].seconds).toBe(3600);
    expect(r.byProject[0].valueCents).toBe(0);
    expect(r.byUser[0].valueCents).toBe(0);
  });

  it("list omits hourlyRateCents for member role and includes it for admin/owner", async () => {
    await service.create(userId, orgId, {
      projectId,
      startedAt: "2026-04-01T09:00:00Z",
      endedAt: "2026-04-01T10:00:00Z",
      billable: true,
    });
    const asAdmin = await service.list(orgId, {}, "admin");
    expect(asAdmin.data[0].hourlyRateCents).toBe(5000);
    const asOwner = await service.list(orgId, {}, "owner");
    expect(asOwner.data[0].hourlyRateCents).toBe(5000);
    const asMember = await service.list(orgId, {}, "member");
    expect("hourlyRateCents" in asMember.data[0]).toBe(false);
    // Other fields still present
    expect(asMember.data[0].durationSec).toBe(3600);
    expect(asMember.data[0].billable).toBe(true);
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

  it("generateInvoice (merged) — unitPrice matches displayed hours x rate (no cents drift)", async () => {
    // Set a rate that triggers per-entry rounding drift: 10 entries of
    // 7:30 (450s) at $75/hr each. Per-entry rounded cents would be
    // Math.round(450/3600 * 7500) = 937 per entry => 9370 total.
    // The displayed label is "1.25h @ $75.00/hr (10 entries)" = $93.75
    // (9375 cents). With the fix, unitPrice is computed in one step and
    // matches the label exactly.
    await prisma.project.update({ where: { id: projectId }, data: { hourlyRateCents: 7500 } });
    const day = new Date("2026-04-01T09:00:00Z").getTime();
    for (let i = 0; i < 10; i++) {
      const start = new Date(day + i * 1000 * 60 * 60);
      const end = new Date(start.getTime() + 450 * 1000); // 7:30
      await service.create(userId, orgId, {
        projectId,
        startedAt: start.toISOString(),
        endedAt: end.toISOString(),
      });
    }
    const { invoiceId } = await service.generateInvoice(userId, orgId, {
      projectId,
      mergeEntries: true,
    });
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true },
    });
    expect(invoice?.lineItems.length).toBe(1);
    const line = invoice!.lineItems[0];
    // 4500 total seconds / 3600 * 7500 = 9375 cents exactly
    expect(line.unitPrice).toBe(9375);
    expect(line.description).toContain("1.25h @ $75.00/hr");
    expect(line.description).toContain("(10 entries)");
    // And it is NOT the per-entry-rounded sum (which drifts low by 5 cents)
    expect(line.unitPrice).not.toBe(9370);
  });
});

describe("TimeEntriesService.listForExport", () => {
  it("returns more than the 200-row paginated cap", async () => {
    // Create 210 short entries spanning different start times.
    const base = new Date("2026-03-01T09:00:00Z").getTime();
    const rows: { startedAt: Date; endedAt: Date }[] = [];
    for (let i = 0; i < 210; i++) {
      const start = new Date(base + i * 60_000);
      const end = new Date(start.getTime() + 60_000);
      rows.push({ startedAt: start, endedAt: end });
    }
    await prisma.timeEntry.createMany({
      data: rows.map((r) => ({
        organizationId: orgId,
        projectId,
        userId,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        durationSec: 60,
        billable: true,
        hourlyRateCents: 5000,
      })),
    });

    // Sanity: paginated list caps at 200 even when limit is huge.
    const paginated = await service.list(orgId, { limit: 10000 });
    expect(paginated.data.length).toBe(200);
    expect(paginated.meta.total).toBe(210);

    // Export path returns all rows.
    const exported = await service.listForExport(orgId, {});
    expect(exported.data.length).toBe(210);
  });
});

describe("TimeEntriesService.start race protection", () => {
  it("partial unique index rejects a second running entry for the same user", async () => {
    // First running entry created normally.
    await service.start(userId, orgId, { projectId });
    // Attempt to insert a second running entry by bypassing service logic
    // (simulating a racing transaction that read `running: null` and
    // proceeded to create). The DB-level partial unique index must reject.
    let err: unknown;
    try {
      await prisma.timeEntry.create({
        data: {
          organizationId: orgId,
          projectId,
          userId,
          startedAt: new Date(),
          hourlyRateCents: 5000,
        },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect((err as { code?: string }).code).toBe("P2002");
  });

  it("does not block a second running entry for a different user", async () => {
    await service.start(userId, orgId, { projectId });
    const other = await prisma.user.create({
      data: { id: `te-user-other-${Date.now()}`, name: "U2", email: `u2-${Date.now()}@x.com`, emailVerified: true },
    });
    await prisma.member.create({
      data: { id: `te-member-other-${Date.now()}`, organizationId: orgId, userId: other.id, role: "admin", hourlyRateCents: 5000 },
    });
    const entry = await service.start(other.id, orgId, { projectId });
    expect(entry.endedAt).toBeNull();
  });
});

