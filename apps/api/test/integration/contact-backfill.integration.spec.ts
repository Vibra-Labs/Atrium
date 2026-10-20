import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Test } from "@nestjs/testing";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ContactSyncService } from "../../src/contact-sync/contact-sync.service";
import { ContactBackfillService } from "../../src/contact-sync/contact-backfill.service";

let prisma: PrismaService;
let backfill: ContactBackfillService;
let orgId: string;

beforeAll(async () => {
  assertDisposableDatabase();
  const mod = await Test.createTestingModule({
    providers: [ContactBackfillService, ContactSyncService, PrismaService],
  }).compile();
  prisma = mod.get(PrismaService);
  backfill = mod.get(ContactBackfillService);
});

afterAll(async () => {
  if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await prisma?.$disconnect();
});

async function counts(): Promise<Record<string, number>> {
  const where = { organizationId: orgId };
  return {
    contacts: await prisma.contact.count({ where }),
    companies: await prisma.company.count({ where }),
    notes: await prisma.contactNote.count({ where }),
    events: await prisma.contactEvent.count({ where }),
    projectContacts: await prisma.projectContact.count({ where: { project: where } }),
    contactLabels: await prisma.contactLabel.count({ where: { contact: where } }),
    leadSources: await prisma.leadSource.count({ where }),
  };
}

describe("ContactBackfillService.run", () => {
  it("turns existing clients, links, labels and paid invoices into contact data, idempotently", async () => {
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    orgId = (await prisma.organization.create({ data: { id: `cb-org-${s}`, name: `cb-${s}`, slug: `cb-${s}` } })).id;
    const owner = await prisma.user.create({ data: { id: `cb-owner-${s}`, name: "Owner", email: `o-${s}@x.com`, emailVerified: true } });
    const client = await prisma.user.create({ data: { id: `cb-client-${s}`, name: "Cleo", email: `Cleo-${s}@X.com`, emailVerified: true } });
    await prisma.member.create({ data: { id: `cb-m-o-${s}`, organizationId: orgId, userId: owner.id, role: "owner" } });
    const member = await prisma.member.create({ data: { id: `cb-m-c-${s}`, organizationId: orgId, userId: client.id, role: "member" } });
    await prisma.company.create({ data: { organizationId: orgId, name: "northwind" } });
    await prisma.clientProfile.create({
      data: { userId: client.id, organizationId: orgId, company: " Northwind ", phone: "555", description: "Likes email" },
    });
    const project = await prisma.project.create({ data: { name: "P", organizationId: orgId } });
    await prisma.projectClient.create({ data: { projectId: project.id, userId: client.id } });
    const label = await prisma.label.create({ data: { name: "VIP", organizationId: orgId } });
    await prisma.memberLabel.create({ data: { memberId: member.id, labelId: label.id } });
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: orgId,
        projectId: project.id,
        invoiceNumber: `INV-${s}`,
        status: "paid",
        lineItems: { create: [{ description: "Work", quantity: 2, unitPrice: 5000 }] },
      },
    });

    await backfill.run();

    const contacts = await prisma.contact.findMany({ where: { organizationId: orgId }, include: { company: true, notes: true } });
    expect(contacts).toHaveLength(1);
    expect(contacts[0].status).toBe("client");
    expect(contacts[0].phone).toBe("555");
    expect(contacts[0].company?.name).toBe("northwind");
    expect(contacts[0].notes).toHaveLength(1);
    expect(contacts[0].notes[0].content).toBe("Likes email");
    expect(contacts[0].notes[0].authorId).toBe(owner.id);
    expect(await prisma.company.count({ where: { organizationId: orgId } })).toBe(1);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(inv.paidAt?.getTime()).toBe(inv.updatedAt.getTime());
    expect(inv.paidAmount).toBe(10000);
    expect(await prisma.contactEvent.count({ where: { organizationId: orgId, type: "invoice_paid" } })).toBe(1);

    const first = await counts();
    expect(first.projectContacts).toBe(1);
    expect(first.contactLabels).toBe(1);
    expect(first.leadSources).toBe(4);

    await backfill.run();
    expect(await counts()).toEqual(first);
  });
});
