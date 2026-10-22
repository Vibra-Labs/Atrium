import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Test } from "@nestjs/testing";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ContactSyncService } from "../../src/contact-sync/contact-sync.service";
import { ContactRevenueService } from "../../src/contacts/contact-revenue.service";
import { ContactsService } from "../../src/contacts/contacts.service";
import { ProjectsService } from "../../src/projects/projects.service";

let prisma: PrismaService;
let sync: ContactSyncService;
let revenue: ContactRevenueService;
let contacts: ContactsService;
let projects: ProjectsService;
const orgIds: string[] = [];
const userIds: string[] = [];
const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  assertDisposableDatabase();
  const mod = await Test.createTestingModule({
    providers: [ContactSyncService, ContactRevenueService, ContactsService, ProjectsService, PrismaService],
  }).compile();
  prisma = mod.get(PrismaService);
  sync = mod.get(ContactSyncService);
  revenue = mod.get(ContactRevenueService);
  contacts = mod.get(ContactsService);
  projects = mod.get(ProjectsService);
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch((e: unknown) => console.error(e));
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch((e: unknown) => console.error(e));
  await prisma?.$disconnect();
});

interface Seed {
  s: string;
  orgId: string;
  userId: string;
  projectId: string;
}

async function seed(): Promise<Seed> {
  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgId = (await prisma.organization.create({ data: { id: `pl-org-${s}`, name: `pl-${s}`, slug: `pl-${s}` } })).id;
  orgIds.push(orgId);
  const userId = `pl-client-${s}`;
  userIds.push(userId);
  await prisma.user.create({ data: { id: userId, name: "Cleo", email: `cleo-${s}@x.com`, emailVerified: true } });
  await prisma.member.create({ data: { id: `pl-m-${s}`, organizationId: orgId, userId, role: "member" } });
  const projectId = (await prisma.project.create({ data: { name: "Site", organizationId: orgId } })).id;
  await prisma.projectClient.create({ data: { projectId, userId } });
  await sync.linkProjectClients(projectId, orgId, [userId]);
  return { s, orgId, userId, projectId };
}

let n = 0;
async function paid(d: Seed, amount: number, paidAt: Date | null): Promise<string> {
  const invoice = await prisma.invoice.create({
    data: {
      organizationId: d.orgId,
      projectId: d.projectId,
      invoiceNumber: `INV-${d.s}-${n++}`,
      type: "uploaded",
      status: "paid",
      amount,
      paidAt,
    },
  });
  await sync.recordInvoicePaid(invoice.id);
  return invoice.id;
}

async function contactOf(d: Seed): Promise<{ id: string; userId: string | null }> {
  return prisma.contact.findFirstOrThrow({ where: { organizationId: d.orgId }, select: { id: true, userId: true } });
}

/** Ends the client's link as if they were taken off the project at `at`. */
async function endAt(d: Seed, at: Date): Promise<void> {
  await sync.endProjectClients(d.projectId, d.orgId, [d.userId]);
  await prisma.projectContact.updateMany({ where: { projectId: d.projectId }, data: { endedAt: at } });
}

async function paidEvents(contactId: string): Promise<number> {
  return prisma.contactEvent.count({ where: { contactId, type: "invoice_paid" } });
}

describe("contact project links", () => {
  it("a client taken off a project keeps earlier revenue but not later invoices", async () => {
    const d = await seed();
    const contact = await contactOf(d);
    await paid(d, 1000, new Date(Date.now() - 2 * DAY_MS));

    await sync.endProjectClients(d.projectId, d.orgId, [d.userId]);
    await paid(d, 500, new Date(Date.now() + 1000));

    expect((await revenue.forContact(contact.id, d.orgId, new Date())).paidCents).toBe(1000);
    expect(await paidEvents(contact.id)).toBe(1);

    // Put back on the project: the link reopens, so new invoices count again.
    await sync.linkProjectClients(d.projectId, d.orgId, [d.userId]);
    await paid(d, 300, new Date(Date.now() + 2000));
    expect((await revenue.forContact(contact.id, d.orgId, new Date(Date.now() + 3000))).paidCents).toBe(1800);
    expect(await paidEvents(contact.id)).toBe(2);
    expect(await prisma.contactEvent.count({ where: { contactId: contact.id, type: "project_linked" } })).toBe(2);
  });

  it("a client who leaves the workspace becomes a past client whose links have ended", async () => {
    const d = await seed();
    const contact = await contactOf(d);
    await paid(d, 1000, new Date(Date.now() - DAY_MS));

    await sync.detachMember(d.orgId, d.userId);
    await paid(d, 700, new Date(Date.now() + 1000));

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect([after.userId, after.status]).toEqual([null, "past_client"]);
    const link = await prisma.projectContact.findFirstOrThrow({ where: { contactId: contact.id } });
    expect(link.endedAt).toBeInstanceOf(Date);
    expect((await revenue.paidTotals(null, d.orgId)).get(contact.id)).toBe(1000);
    expect(await paidEvents(contact.id)).toBe(1);
  });

  it("an invoice backdated to before the link ended still lands on the timeline", async () => {
    const d = await seed();
    const contact = await contactOf(d);
    await sync.endProjectClients(d.projectId, d.orgId, [d.userId]);
    await paid(d, 400, new Date(Date.now() - DAY_MS));
    expect(await paidEvents(contact.id)).toBe(1);
    expect((await revenue.forContact(contact.id, d.orgId, new Date())).paidCents).toBe(400);
  });

  it("a client put back on a project doesn't get invoices paid while they were off it", async () => {
    const d = await seed();
    const contact = await contactOf(d);
    const company = await prisma.company.create({ data: { organizationId: d.orgId, name: `Co ${d.s}` } });
    await prisma.contact.update({ where: { id: contact.id }, data: { companyId: company.id } });
    const now = Date.now();
    await paid(d, 1000, new Date(now - 5 * DAY_MS));
    await endAt(d, new Date(now - 3 * DAY_MS));
    await paid(d, 500, new Date(now - 2 * DAY_MS));

    await sync.linkProjectClients(d.projectId, d.orgId, [d.userId]);
    await paid(d, 300, new Date(now + 1000));
    // Backdated into the gap after the link reopened: still not theirs.
    await paid(d, 200, new Date(now - 2.5 * DAY_MS));

    const later = new Date(now + 2000);
    expect((await revenue.forContact(contact.id, d.orgId, later)).paidCents).toBe(1300);
    expect((await revenue.paidTotals(null, d.orgId)).get(contact.id)).toBe(1300);
    expect((await revenue.paidTotals([contact.id], d.orgId)).get(contact.id)).toBe(1300);
    expect((await revenue.paidTotalsForCompanies([company.id], d.orgId)).get(company.id)).toBe(1300);
    expect((await revenue.forCompany(company.id, d.orgId, later)).paidCents).toBe(1300);
    expect(await paidEvents(contact.id)).toBe(2);
  });

  it("re-linking a contact by hand keeps the gap too", async () => {
    const d = await seed();
    const contact = await contactOf(d);
    const now = Date.now();
    await paid(d, 1000, new Date(now - 5 * DAY_MS));
    await endAt(d, new Date(now - 3 * DAY_MS));
    await paid(d, 500, new Date(now - 2 * DAY_MS));

    await contacts.linkProject(contact.id, d.projectId, d.orgId);
    await paid(d, 300, new Date(now + 1000));

    expect((await revenue.forContact(contact.id, d.orgId, new Date(now + 2000))).paidCents).toBe(1300);
    const link = await prisma.projectContact.findFirstOrThrow({ where: { contactId: contact.id } });
    expect(link.endedAt).toBeNull();
  });

  it("the contact page shows when a project link ended", async () => {
    const d = await seed();
    const contact = await contactOf(d);
    const at = new Date(Date.now() - DAY_MS);
    await endAt(d, at);

    const detail = await contacts.findOne(contact.id, d.orgId);
    expect(detail.projects).toEqual([expect.objectContaining({ id: d.projectId, endedAt: at })]);
  });

  it("a paid invoice with no date counts toward an ended link and lands on its timeline", async () => {
    const d = await seed();
    const contact = await contactOf(d);
    await endAt(d, new Date(Date.now() - DAY_MS));
    await paid(d, 400, null);

    expect((await revenue.forContact(contact.id, d.orgId, new Date())).paidCents).toBe(400);
    expect(await paidEvents(contact.id)).toBe(1);
  });

  it("concurrent client edits leave each client's link open exactly when they're on the project", async () => {
    const d = await seed();
    const other = `pl-client2-${d.s}`;
    userIds.push(other);
    await prisma.user.create({ data: { id: other, name: "Bo", email: `bo-${d.s}@x.com`, emailVerified: true } });
    await prisma.member.create({ data: { id: `pl-m2-${d.s}`, organizationId: d.orgId, userId: other, role: "member" } });

    for (let i = 0; i < 5; i++) {
      await Promise.all([
        projects.update(d.projectId, { clientUserIds: [d.userId, other] }, d.orgId),
        projects.update(d.projectId, { clientUserIds: [d.userId] }, d.orgId),
      ]);
      const onProject: string[] = (
        await prisma.projectClient.findMany({ where: { projectId: d.projectId }, select: { userId: true } })
      ).map((c) => c.userId);
      const open: string[] = (
        await prisma.projectContact.findMany({
          where: { projectId: d.projectId, endedAt: null },
          select: { contact: { select: { userId: true } } },
        })
      ).flatMap((l) => (l.contact.userId ? [l.contact.userId] : []));
      expect(open.sort()).toEqual(onProject.sort());
    }
  });
});
