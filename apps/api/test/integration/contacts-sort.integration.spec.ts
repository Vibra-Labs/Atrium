import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Test } from "@nestjs/testing";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ContactsService } from "../../src/contacts/contacts.service";
import { CompaniesService } from "../../src/contacts/companies.service";
import { ContactRevenueService } from "../../src/contacts/contact-revenue.service";
import { contactSortValue, rankRows } from "../../src/contacts/contacts-sort";
import type { ContactSort, ListContactsQueryDto, SortDirection } from "../../src/contacts/contacts.dto";

let prisma: PrismaService;
let contacts: ContactsService;
let companies: CompaniesService;
let orgId: string;
let otherOrgId: string;
const ids: Record<string, string> = {};
let n = 0;

async function paidInvoice(projectId: string, amount: number): Promise<void> {
  await prisma.invoice.create({
    data: {
      organizationId: orgId,
      projectId,
      invoiceNumber: `INV-sort-${orgId}-${n++}`,
      type: "uploaded",
      status: "paid",
      amount,
      paidAt: new Date(),
    },
  });
}

beforeAll(async () => {
  assertDisposableDatabase();
  const mod = await Test.createTestingModule({
    providers: [ContactsService, CompaniesService, ContactRevenueService, PrismaService],
  }).compile();
  prisma = mod.get(PrismaService);
  contacts = mod.get(ContactsService);
  companies = mod.get(CompaniesService);
  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  orgId = (await prisma.organization.create({ data: { id: `cs-org-${s}`, name: `cs-${s}`, slug: `cs-${s}` } })).id;
  otherOrgId = (
    await prisma.organization.create({ data: { id: `cs-org2-${s}`, name: `cs2-${s}`, slug: `cs2-${s}` } })
  ).id;

  const co = async (name: string): Promise<string> =>
    (await prisma.company.create({ data: { organizationId: orgId, name } })).id;
  const acme = await co("acme");
  const zeta = await co("Zeta");
  const beta = await co("Beta");
  const empty = await co("Empty");
  ids.acme = acme;
  ids.zeta = zeta;
  ids.beta = beta;
  ids.empty = empty;

  // Names exercise case, punctuation and exact ties (two "Ann").
  const people: Array<{ key: string; name: string; status: string; companyId: string | null; paid: number[] }> = [
    { key: "ann1", name: "Ann", status: "client", companyId: acme, paid: [500] },
    { key: "ann2", name: "Ann", status: "client", companyId: null, paid: [] },
    { key: "ann3", name: "ann", status: "lead", companyId: zeta, paid: [500] },
    { key: "bob", name: "Bob", status: "past_client", companyId: beta, paid: [100, 200] },
    { key: "bobb", name: "bob b", status: "lead", companyId: acme, paid: [] },
    { key: "under", name: "_x", status: "client", companyId: null, paid: [9000] },
    { key: "zed", name: "Zed", status: "past_client", companyId: zeta, paid: [] },
    { key: "carl", name: "carl", status: "lead", companyId: beta, paid: [50] },
    { key: "dee", name: "Dee", status: "weird", companyId: null, paid: [] },
  ];
  for (const p of people) {
    const c = await prisma.contact.create({
      data: { organizationId: orgId, name: p.name, status: p.status, companyId: p.companyId },
    });
    ids[p.key] = c.id;
    for (const amount of p.paid) {
      const project = await prisma.project.create({ data: { name: `P-${p.key}`, organizationId: orgId } });
      await prisma.projectContact.create({ data: { projectId: project.id, contactId: c.id } });
      await paidInvoice(project.id, amount);
    }
  }
  // A label to filter on.
  const label = await prisma.label.create({ data: { organizationId: orgId, name: "vip", color: "#000" } });
  ids.label = label.id;
  for (const key of ["ann1", "bob", "carl", "zed"]) {
    await prisma.contactLabel.create({ data: { contactId: ids[key], labelId: label.id } });
  }
  // Noise in another workspace must never show up.
  await prisma.contact.create({ data: { organizationId: otherOrgId, name: "Aaron", status: "lead" } });
});

afterAll(async () => {
  await prisma.organization
    .deleteMany({ where: { id: { in: [orgId, otherOrgId] } } })
    .catch((e: unknown) => console.error(e));
  await prisma?.$disconnect();
});

/** The ranking the list used before it moved to SQL: rank every match in JS. */
async function expectedOrder(query: ListContactsQueryDto): Promise<string[]> {
  const pending = await contacts.pendingInviteEmails(orgId);
  const where = (
    contacts as unknown as {
      buildWhere: (o: string, q: ListContactsQueryDto, p: string[]) => object;
    }
  ).buildWhere(orgId, query, pending);
  const rows = await prisma.contact.findMany({
    where,
    select: { id: true, name: true, status: true, followUpAt: true, company: { select: { name: true } } },
  });
  const paid = await (contacts as unknown as { revenue: ContactRevenueService }).revenue.paidTotals(null, orgId);
  const sort: ContactSort = query.sort ?? "name";
  const dir: SortDirection = query.dir ?? (sort === "paid" ? "desc" : "asc");
  return rankRows(
    rows.map((r) => ({ ...r, companyName: r.company?.name ?? null })),
    dir,
    (r) => contactSortValue(sort, r, paid),
  );
}

/** Every page of the list at `limit`, concatenated. */
async function allPages(query: ListContactsQueryDto, limit: number): Promise<{ ids: string[]; total: number }> {
  const out: string[] = [];
  let total = 0;
  for (let page = 1; page <= 20; page++) {
    const res = await contacts.findAll(orgId, { ...query, page, limit });
    total = res.meta.total;
    out.push(...res.data.map((c) => c.id));
    if (res.data.length < limit) break;
  }
  return { ids: out, total };
}

const k = (...keys: string[]): string[] => keys.map((key) => ids[key]);

describe("contacts list SQL sorts (Postgres)", () => {
  it("orders by status in pipeline order, unknown last, ties by name then id", async () => {
    const { ids: got, total } = await allPages({ sort: "status" }, 4);
    const [ann1, ann2] = [ids.ann1, ids.ann2].sort();
    expect(got).toEqual([
      ...k("ann3", "bobb", "carl"),
      ...k("under"),
      ann1,
      ann2,
      ...k("bob", "zed", "dee"),
    ]);
    expect(total).toBe(9);
    const desc = (await allPages({ sort: "status", dir: "desc" }, 4)).ids;
    expect(desc.slice(0, 2)).toEqual(k("bob", "zed"));
    expect(desc.at(-1)).toBe(ids.dee);
  });

  it("orders by company case-insensitively with blank companies last in both directions", async () => {
    const asc = (await allPages({ sort: "company" }, 2)).ids;
    // acme: Ann, bob b; Beta: Bob, carl; Zeta: ann, Zed; then blanks: _x, Ann, Dee.
    expect(asc.slice(0, 6)).toEqual(k("ann1", "bobb", "bob", "carl", "ann3", "zed"));
    expect(asc.slice(6)).toEqual(k("under", "ann2", "dee"));
    const desc = (await allPages({ sort: "company", dir: "desc" }, 2)).ids;
    expect(desc).toEqual(k("ann3", "zed", "bob", "carl", "ann1", "bobb", "under", "ann2", "dee"));
  });

  it("orders by paid, desc by default, zero-paid ranked as 0", async () => {
    const desc = (await allPages({ sort: "paid" }, 3)).ids;
    expect(desc.slice(0, 4)).toEqual(k("under", "ann3", "ann1", "bob"));
    expect(desc[4]).toBe(ids.carl);
    const asc = (await allPages({ sort: "paid", dir: "asc" }, 3)).ids;
    expect(asc.at(-1)).toBe(ids.under);
    expect(asc.at(-5)).toBe(ids.carl);
  });

  for (const sort of ["status", "company", "paid"] as const) {
    for (const dir of ["asc", "desc"] as const) {
      it(`${sort} ${dir}: pages match the in-memory ranking with no gaps or duplicates`, async () => {
        for (const limit of [1, 2, 4, 20]) {
          const { ids: got, total } = await allPages({ sort, dir }, limit);
          expect(got).toEqual(await expectedOrder({ sort, dir }));
          expect(new Set(got).size).toBe(got.length);
          expect(total).toBe(9);
        }
      });
    }

    it(`${sort}: applies search, label and status filters`, async () => {
      for (const filter of [{ search: "b" }, { labelId: ids.label }, { status: "lead" as const }, { search: "zeta" }]) {
        const query: ListContactsQueryDto = { sort, ...filter };
        const { ids: got, total } = await allPages(query, 2);
        const expected = await expectedOrder(query);
        expect(got).toEqual(expected);
        expect(total).toBe(expected.length);
      }
    });
  }

  it("returns the page rows with their paid totals and company", async () => {
    const res = await contacts.findAll(orgId, { sort: "paid", page: 1, limit: 2 });
    expect(res.data.map((c) => [c.id, c.paidCents])).toEqual([
      [ids.under, 9000],
      [ids.ann3, 500],
    ]);
    expect(res.data[1].company?.name).toBe("Zeta");
    expect(res.meta.total).toBe(9);
  });

  it("an empty match returns an empty page", async () => {
    const res = await contacts.findAll(orgId, { sort: "company", search: "no-such-thing" });
    expect(res.data).toEqual([]);
    expect(res.meta.total).toBe(0);
  });
});

describe("companies list SQL sorts (Postgres)", () => {
  async function companyPages(sort: "people" | "paid", dir: SortDirection | undefined, limit: number) {
    const out: Array<{ id: string; paidCents: number }> = [];
    for (let page = 1; page <= 10; page++) {
      const res = await companies.findAll(orgId, page, limit, undefined, sort, dir);
      out.push(...res.data.map((c) => ({ id: c.id, paidCents: c.paidCents })));
      if (res.data.length < limit) break;
    }
    return out;
  }

  it("orders by paid desc by default, ties by name, and pages without gaps", async () => {
    // acme 500, Zeta 500, Beta 350, Empty 0.
    for (const limit of [1, 3]) {
      const desc = await companyPages("paid", undefined, limit);
      expect(desc).toEqual([
        { id: ids.acme, paidCents: 500 },
        { id: ids.zeta, paidCents: 500 },
        { id: ids.beta, paidCents: 350 },
        { id: ids.empty, paidCents: 0 },
      ]);
      const asc = await companyPages("paid", "asc", limit);
      expect(asc.map((c) => c.id)).toEqual([ids.empty, ids.beta, ids.acme, ids.zeta]);
    }
  });

  it("orders by people count with ties by name, and pages without gaps", async () => {
    for (const limit of [1, 3]) {
      const desc = await companyPages("people", "desc", limit);
      // acme 2, Beta 2, Zeta 2, Empty 0 (Prisma's name tie-break uses the database collation).
      expect(desc.map((c) => c.id).at(-1)).toBe(ids.empty);
      expect(new Set(desc.map((c) => c.id)).size).toBe(4);
      const asc = await companyPages("people", "asc", limit);
      expect(asc[0].id).toBe(ids.empty);
      expect(asc).toHaveLength(4);
    }
  });

  it("filters by search for the paid sort", async () => {
    const res = await companies.findAll(orgId, 1, 20, "eta", "paid");
    expect(res.data.map((c) => c.id)).toEqual([ids.zeta, ids.beta]);
    expect(res.meta.total).toBe(2);
  });
});
