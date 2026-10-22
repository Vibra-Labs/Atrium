import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Test } from "@nestjs/testing";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ContactRevenueService } from "../../src/contacts/contact-revenue.service";

let prisma: PrismaService;
let revenue: ContactRevenueService;
const orgIds: string[] = [];

beforeAll(async () => {
  assertDisposableDatabase();
  const mod = await Test.createTestingModule({
    providers: [ContactRevenueService, PrismaService],
  }).compile();
  prisma = mod.get(PrismaService);
  revenue = mod.get(ContactRevenueService);
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch((e: unknown) => console.error(e));
  await prisma?.$disconnect();
});

interface Seed {
  orgId: string;
  projectId: string;
  contactId: string;
  s: string;
}

async function seed(): Promise<Seed> {
  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { id: `cr-org-${s}`, name: `cr-${s}`, slug: `cr-${s}` } });
  orgIds.push(org.id);
  const project = await prisma.project.create({ data: { name: "P", organizationId: org.id } });
  const contact = await prisma.contact.create({ data: { organizationId: org.id, name: "A", email: `a-${s}@x.com` } });
  await prisma.projectContact.create({ data: { projectId: project.id, contactId: contact.id } });
  return { orgId: org.id, projectId: project.id, contactId: contact.id, s };
}

let n = 0;
function uploaded(
  d: Seed,
  status: string,
  amount: number,
  extra: { paidAt?: Date; paidAmount?: number; projectId?: string | null } = {},
) {
  return prisma.invoice.create({
    data: {
      organizationId: d.orgId,
      projectId: extra.projectId === undefined ? d.projectId : extra.projectId,
      invoiceNumber: `INV-${d.s}-${n++}`,
      type: "uploaded",
      status,
      amount,
      paidAt: extra.paidAt,
      paidAmount: extra.paidAmount,
    },
  });
}

describe("ContactRevenueService", () => {
  it("contact sums only paid invoices on linked projects", async () => {
    const d = await seed();
    await uploaded(d, "paid", 400000, { paidAt: new Date() });
    await uploaded(d, "sent", 200000);
    await uploaded(d, "draft", 999);
    await prisma.invoice.create({
      data: {
        organizationId: d.orgId,
        projectId: d.projectId,
        invoiceNumber: `INV-${d.s}-li`,
        status: "overdue",
        lineItems: {
          create: [
            { description: "x", quantity: 2, unitPrice: 50 },
            { description: "y", quantity: 1, unitPrice: 25 },
          ],
        },
      },
    });
    const r = await revenue.forContact(d.contactId, d.orgId, new Date());
    expect(r.paidCents).toBe(400000);
    expect(r.outstandingCents).toBe(200125);
    const totals = await revenue.paidTotals([d.contactId], d.orgId);
    expect(totals.get(d.contactId)).toBe(400000);
  });

  it("uses paidAmount over the invoice total when present", async () => {
    const d = await seed();
    await uploaded(d, "paid", 1000, { paidAt: new Date(), paidAmount: 700 });
    expect((await revenue.forContact(d.contactId, d.orgId, new Date())).paidCents).toBe(700);
  });

  it("sums several line items once per invoice and prefers a partial paidAmount", async () => {
    const d = await seed();
    const company = await prisma.company.create({ data: { organizationId: d.orgId, name: "Co" } });
    await prisma.contact.update({ where: { id: d.contactId }, data: { companyId: company.id } });
    // A second contact on the same project fans the join out; totals must not double.
    const second = await prisma.contact.create({
      data: { organizationId: d.orgId, name: "B", email: `b-${d.s}@x.com`, companyId: company.id },
    });
    await prisma.projectContact.create({ data: { projectId: d.projectId, contactId: second.id } });
    const items = {
      create: [
        { description: "a", quantity: 3, unitPrice: 1000 },
        { description: "b", quantity: 1, unitPrice: 250 },
        { description: "c", quantity: 2, unitPrice: 125 },
      ],
    };
    // Total 3500, paid 2000 of it.
    await prisma.invoice.create({
      data: {
        organizationId: d.orgId,
        projectId: d.projectId,
        invoiceNumber: `INV-${d.s}-partial`,
        status: "paid",
        paidAt: new Date(),
        paidAmount: 2000,
        lineItems: items,
      },
    });
    // Total 3500, fully paid.
    await prisma.invoice.create({
      data: {
        organizationId: d.orgId,
        projectId: d.projectId,
        invoiceNumber: `INV-${d.s}-full`,
        status: "paid",
        paidAt: new Date(),
        lineItems: items,
      },
    });
    // Total 3500 outstanding.
    await prisma.invoice.create({
      data: {
        organizationId: d.orgId,
        projectId: d.projectId,
        invoiceNumber: `INV-${d.s}-sent`,
        status: "sent",
        lineItems: items,
      },
    });

    const r = await revenue.forContact(d.contactId, d.orgId, new Date());
    expect(r.paidCents).toBe(5500);
    expect(r.outstandingCents).toBe(3500);
    expect((await revenue.forCompany(company.id, d.orgId, new Date())).paidCents).toBe(5500);
    const totals = await revenue.paidTotals(null, d.orgId);
    expect(totals.get(d.contactId)).toBe(5500);
    expect(totals.get(second.id)).toBe(5500);
    expect((await revenue.paidTotals([second.id], d.orgId)).get(second.id)).toBe(5500);
    expect((await revenue.paidTotalsForCompanies(null, d.orgId)).get(company.id)).toBe(5500);
  });

  it("monthly has 12 buckets and groups by paidAt month", async () => {
    const d = await seed();
    const now = new Date(Date.UTC(2026, 9, 20));
    await uploaded(d, "paid", 100, { paidAt: new Date(Date.UTC(2026, 9, 1)) });
    await uploaded(d, "paid", 200, { paidAt: new Date(Date.UTC(2026, 9, 15)) });
    await uploaded(d, "paid", 300, { paidAt: new Date(Date.UTC(2026, 0, 31, 23, 59)) });
    await uploaded(d, "paid", 400, { paidAt: new Date(Date.UTC(2025, 10, 5)) });
    await uploaded(d, "paid", 500, { paidAt: new Date(Date.UTC(2025, 9, 5)) }); // outside window
    const r = await revenue.forContact(d.contactId, d.orgId, now);
    expect(r.monthly).toHaveLength(12);
    expect(r.monthly[0]).toEqual({ month: "2025-11", paidCents: 400 });
    expect(r.monthly[11]).toEqual({ month: "2026-10", paidCents: 300 });
    expect(r.monthly.find((m) => m.month === "2026-01")?.paidCents).toBe(300);
    expect(r.monthly.find((m) => m.month === "2026-05")?.paidCents).toBe(0);
    expect(r.paidCents).toBe(1500);
  });

  it("company counts a shared invoice once", async () => {
    const d = await seed();
    const company = await prisma.company.create({ data: { organizationId: d.orgId, name: "Co" } });
    await prisma.contact.update({ where: { id: d.contactId }, data: { companyId: company.id } });
    const second = await prisma.contact.create({
      data: { organizationId: d.orgId, name: "B", email: `b-${d.s}@x.com`, companyId: company.id },
    });
    await prisma.projectContact.create({ data: { projectId: d.projectId, contactId: second.id } });
    await uploaded(d, "paid", 100000, { paidAt: new Date() });
    await uploaded(d, "sent", 5000);
    const c = await revenue.forCompany(company.id, d.orgId, new Date());
    expect(c.paidCents).toBe(100000);
    expect(c.outstandingCents).toBe(5000);
    expect((await revenue.forContact(d.contactId, d.orgId, new Date())).paidCents).toBe(100000);
    expect((await revenue.forContact(second.id, d.orgId, new Date())).paidCents).toBe(100000);
    const totals = await revenue.paidTotals([d.contactId, second.id], d.orgId);
    expect(totals.get(second.id)).toBe(100000);
    const byCompany = await revenue.paidTotalsForCompanies([company.id], d.orgId);
    expect(byCompany.get(company.id)).toBe(100000);
    expect((await revenue.paidTotalsForCompanies([company.id], (await seed()).orgId)).size).toBe(0);
  });

  it("whole-workspace totals (null ids) match the per-id totals and stay in the workspace", async () => {
    const d = await seed();
    const company = await prisma.company.create({ data: { organizationId: d.orgId, name: "Co" } });
    await prisma.contact.update({ where: { id: d.contactId }, data: { companyId: company.id } });
    await uploaded(d, "paid", 7000, { paidAt: new Date() });
    const other = await seed();
    await uploaded(other, "paid", 300, { paidAt: new Date() });

    const all = await revenue.paidTotals(null, d.orgId);
    expect([...all.entries()]).toEqual([[d.contactId, 7000]]);
    const allCompanies = await revenue.paidTotalsForCompanies(null, d.orgId);
    expect([...allCompanies.entries()]).toEqual([[company.id, 7000]]);
  });

  it("totals for more ids than Postgres allows bind parameters (a large export) still work", async () => {
    const d = await seed();
    await uploaded(d, "paid", 7000, { paidAt: new Date() });
    const ids: string[] = [d.contactId, ...Array.from({ length: 40_000 }, (_, i) => `missing-${i}`)];

    expect([...(await revenue.paidTotals(ids, d.orgId)).entries()]).toEqual([[d.contactId, 7000]]);
    expect((await revenue.paidTotalsForCompanies(ids, d.orgId)).size).toBe(0);
  });

  it("an ended link counts invoices paid until it ended, and nothing outstanding", async () => {
    const d = await seed();
    const day = 24 * 60 * 60 * 1000;
    const company = await prisma.company.create({ data: { organizationId: d.orgId, name: "Co" } });
    await prisma.contact.update({ where: { id: d.contactId }, data: { companyId: company.id } });
    await prisma.projectContact.updateMany({
      where: { projectId: d.projectId, contactId: d.contactId },
      data: { endedAt: new Date(Date.now() - day) },
    });
    const current = await prisma.contact.create({
      data: { organizationId: d.orgId, name: "B", email: `b-${d.s}@x.com`, companyId: company.id },
    });
    await prisma.projectContact.create({ data: { projectId: d.projectId, contactId: current.id } });
    await uploaded(d, "paid", 1000, { paidAt: new Date(Date.now() - 2 * day) });
    await uploaded(d, "paid", 500, { paidAt: new Date() });
    await uploaded(d, "sent", 200);

    const ended = await revenue.forContact(d.contactId, d.orgId, new Date());
    expect([ended.paidCents, ended.outstandingCents]).toEqual([1000, 0]);
    const open = await revenue.forContact(current.id, d.orgId, new Date());
    expect([open.paidCents, open.outstandingCents]).toEqual([1500, 200]);

    for (const ids of [[d.contactId, current.id], null]) {
      const totals = await revenue.paidTotals(ids, d.orgId);
      expect([totals.get(d.contactId), totals.get(current.id)]).toEqual([1000, 1500]);
    }
    const co = await revenue.forCompany(company.id, d.orgId, new Date());
    expect([co.paidCents, co.outstandingCents]).toEqual([1500, 200]);
    expect((await revenue.paidTotalsForCompanies(null, d.orgId)).get(company.id)).toBe(1500);
  });

  it("invoices without a project are not counted", async () => {
    const d = await seed();
    await uploaded(d, "paid", 50000, { paidAt: new Date(), projectId: null });
    const r = await revenue.forContact(d.contactId, d.orgId, new Date());
    expect(r.paidCents).toBe(0);
    expect(r.outstandingCents).toBe(0);
  });

  it("is scoped to the organization", async () => {
    const d = await seed();
    await uploaded(d, "paid", 100, { paidAt: new Date() });
    const other = await seed();
    expect((await revenue.forContact(d.contactId, other.orgId, new Date())).paidCents).toBe(0);
  });
});
