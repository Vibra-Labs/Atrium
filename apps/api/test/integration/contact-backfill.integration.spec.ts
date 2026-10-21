import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Test } from "@nestjs/testing";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ContactSyncService } from "../../src/contact-sync/contact-sync.service";
import { ContactBackfillService } from "../../src/contact-sync/contact-backfill.service";

let prisma: PrismaService;
let backfill: ContactBackfillService;
let orgId: string;
const orgIds: string[] = [];
const userIds: string[] = [];

beforeAll(async () => {
  assertDisposableDatabase();
  const mod = await Test.createTestingModule({
    providers: [ContactBackfillService, ContactSyncService, PrismaService],
  }).compile();
  prisma = mod.get(PrismaService);
  backfill = mod.get(ContactBackfillService);
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch((e: unknown) => console.error(e));
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch((e: unknown) => console.error(e));
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
    orgIds.push(orgId);
    userIds.push(`cb-owner-${s}`, `cb-client-${s}`);
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
    expect(contacts[0].phones).toEqual([{ label: "Phone", number: "555" }]);
    expect([contacts[0].firstName, contacts[0].lastName]).toEqual(["Cleo", null]);
    expect(contacts[0].company?.name).toBe("northwind");
    // The profile description becomes About, not a note.
    expect(contacts[0].description).toBe("Likes email");
    expect(contacts[0].notes).toHaveLength(0);
    expect(owner.id).toBeTruthy();
    expect(await prisma.company.count({ where: { organizationId: orgId } })).toBe(1);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(inv.paidAt?.getTime()).toBe(inv.updatedAt.getTime());
    expect(inv.paidAmount).toBe(10000);
    expect(await prisma.contactEvent.count({ where: { organizationId: orgId, type: "invoice_paid" } })).toBe(1);

    const first = await counts();
    expect(first.projectContacts).toBe(1);
    expect(first.contactLabels).toBe(1);
    expect(first.leadSources).toBe(4);

    expect(await prisma.memberLabel.count({ where: { memberId: member.id } })).toBe(0);

    await backfill.run();
    expect(await counts()).toEqual(first);
  });

  it("splits names and seeds phones from the legacy phone, once, keeping updatedAt", async () => {
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    orgId = (await prisma.organization.create({ data: { id: `cb8-org-${s}`, name: `cb8-${s}`, slug: `cb8-${s}` } })).id;
    orgIds.push(orgId);
    const legacy = await prisma.contact.create({ data: { organizationId: orgId, name: "Ann Marie Lee", phone: "555" } });
    const mono = await prisma.contact.create({ data: { organizationId: orgId, name: "Cher" } });
    const modern = await prisma.contact.create({
      data: {
        organizationId: orgId,
        name: "Bo Diddley",
        firstName: "Bo",
        lastName: "Diddley",
        phone: "111",
        phones: [{ label: "Work", number: "111" }],
      },
    });

    await backfill.run();

    const a = await prisma.contact.findUniqueOrThrow({ where: { id: legacy.id } });
    expect([a.firstName, a.lastName]).toEqual(["Ann", "Marie Lee"]);
    expect(a.phones).toEqual([{ label: "Phone", number: "555" }]);
    expect(a.updatedAt.getTime()).toBe(legacy.updatedAt.getTime());
    const c = await prisma.contact.findUniqueOrThrow({ where: { id: mono.id } });
    expect([c.firstName, c.lastName]).toEqual(["Cher", null]);
    expect(c.phones).toEqual([]);
    const b = await prisma.contact.findUniqueOrThrow({ where: { id: modern.id } });
    expect(b.phones).toEqual([{ label: "Work", number: "111" }]);

    await prisma.contact.update({ where: { id: legacy.id }, data: { lastName: null, name: "Ann" } });
    await backfill.run();
    const again = await prisma.contact.findUniqueOrThrow({ where: { id: legacy.id } });
    expect([again.name, again.firstName, again.lastName]).toEqual(["Ann", "Ann", null]);
    expect(again.phones).toEqual([{ label: "Phone", number: "555" }]);
  });

  it("does not re-seed deleted or renamed lead sources", async () => {
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    orgId = (await prisma.organization.create({ data: { id: `cb3-org-${s}`, name: `cb3-${s}`, slug: `cb3-${s}` } })).id;
    orgIds.push(orgId);

    await backfill.run();
    expect(await prisma.leadSource.count({ where: { organizationId: orgId } })).toBe(4);

    await prisma.leadSource.deleteMany({ where: { organizationId: orgId, name: "Social" } });
    await prisma.leadSource.updateMany({ where: { organizationId: orgId, name: "Event" }, data: { name: "Events" } });
    await backfill.run();

    const names = (await prisma.leadSource.findMany({ where: { organizationId: orgId } })).map((l) => l.name).sort();
    expect(names).toEqual(["Events", "Referral", "Website"]);
  });

  it("copies member tags once, so a removed contact tag stays removed", async () => {
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    orgId = (await prisma.organization.create({ data: { id: `cb4-org-${s}`, name: `cb4-${s}`, slug: `cb4-${s}` } })).id;
    orgIds.push(orgId);
    userIds.push(`cb4-client-${s}`);
    const client = await prisma.user.create({ data: { id: `cb4-client-${s}`, name: "Tia", email: `tia-${s}@x.com`, emailVerified: true } });
    const member = await prisma.member.create({ data: { id: `cb4-m-c-${s}`, organizationId: orgId, userId: client.id, role: "member" } });
    const vip = await prisma.label.create({ data: { name: "VIP", organizationId: orgId } });
    const hot = await prisma.label.create({ data: { name: "Hot", organizationId: orgId } });
    await prisma.memberLabel.createMany({ data: [{ memberId: member.id, labelId: vip.id }, { memberId: member.id, labelId: hot.id }] });

    await backfill.run();
    const contact = await prisma.contact.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(await prisma.contactLabel.count({ where: { contactId: contact.id } })).toBe(2);
    expect(await prisma.memberLabel.count({ where: { memberId: member.id } })).toBe(0);

    await prisma.contactLabel.deleteMany({ where: { contactId: contact.id, labelId: vip.id } });
    await backfill.run();
    const left = await prisma.contactLabel.findMany({ where: { contactId: contact.id } });
    expect(left.map((l) => l.labelId)).toEqual([hot.id]);
  });

  it("migrates client member tags but leaves staff member tags in MemberLabel", async () => {
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    orgId = (await prisma.organization.create({ data: { id: `cb6-org-${s}`, name: `cb6-${s}`, slug: `cb6-${s}` } })).id;
    orgIds.push(orgId);
    userIds.push(`cb6-owner-${s}`, `cb6-admin-${s}`, `cb6-client-${s}`);
    const owner = await prisma.user.create({ data: { id: `cb6-owner-${s}`, name: "Olga", email: `olga-${s}@x.com`, emailVerified: true } });
    const admin = await prisma.user.create({ data: { id: `cb6-admin-${s}`, name: "Ada", email: `ada-${s}@x.com`, emailVerified: true } });
    const client = await prisma.user.create({ data: { id: `cb6-client-${s}`, name: "Cy", email: `cy-${s}@x.com`, emailVerified: true } });
    const ownerM = await prisma.member.create({ data: { id: `cb6-m-o-${s}`, organizationId: orgId, userId: owner.id, role: "owner" } });
    const adminM = await prisma.member.create({ data: { id: `cb6-m-a-${s}`, organizationId: orgId, userId: admin.id, role: "admin" } });
    const clientM = await prisma.member.create({ data: { id: `cb6-m-c-${s}`, organizationId: orgId, userId: client.id, role: "member" } });
    // The admin was once a client: their old contact is still linked to them.
    await prisma.contact.create({ data: { organizationId: orgId, name: "Ada", email: admin.email, userId: admin.id, status: "past_client" } });
    const design = await prisma.label.create({ data: { name: "Design", organizationId: orgId } });
    await prisma.memberLabel.createMany({
      data: [
        { memberId: ownerM.id, labelId: design.id },
        { memberId: adminM.id, labelId: design.id },
        { memberId: clientM.id, labelId: design.id },
      ],
    });

    await backfill.run();

    const remaining = await prisma.memberLabel.findMany({ where: { member: { organizationId: orgId } } });
    expect(remaining.map((r) => r.memberId).sort()).toEqual([adminM.id, ownerM.id].sort());
    const clientContact = await prisma.contact.findFirstOrThrow({ where: { organizationId: orgId, userId: client.id } });
    expect(await prisma.contactLabel.count({ where: { contactId: clientContact.id } })).toBe(1);
    expect(await prisma.contactLabel.count({ where: { contact: { organizationId: orgId } } })).toBe(1);
  });

  it("role changes: a demoted admin's tags move to their contact and stay there after re-promotion", async () => {
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    orgId = (await prisma.organization.create({ data: { id: `cb7-org-${s}`, name: `cb7-${s}`, slug: `cb7-${s}` } })).id;
    orgIds.push(orgId);
    userIds.push(`cb7-admin-${s}`);
    const sync = new ContactSyncService(prisma);
    const user = await prisma.user.create({ data: { id: `cb7-admin-${s}`, name: "Dee", email: `dee-${s}@x.com`, emailVerified: true } });
    const member = await prisma.member.create({ data: { id: `cb7-m-${s}`, organizationId: orgId, userId: user.id, role: "admin" } });
    const label = await prisma.label.create({ data: { name: "Design", organizationId: orgId } });
    await prisma.memberLabel.create({ data: { memberId: member.id, labelId: label.id } });

    // Demote (the member row changes first, as in changeRole and the Better Auth hook).
    await prisma.member.update({ where: { id: member.id }, data: { role: "member" } });
    await sync.syncRoleChange(orgId, user.id, "admin", "member");

    const contact = await prisma.contact.findFirstOrThrow({ where: { organizationId: orgId, userId: user.id } });
    expect(contact.status).toBe("client");
    expect((await prisma.contactLabel.findMany({ where: { contactId: contact.id } })).map((l) => l.labelId)).toEqual([label.id]);
    expect(await prisma.memberLabel.count({ where: { memberId: member.id } })).toBe(0);

    // Promote again: the contact becomes a past-client record and keeps its tags.
    await prisma.member.update({ where: { id: member.id }, data: { role: "admin" } });
    await sync.syncRoleChange(orgId, user.id, "member", "admin");

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.userId).toBeNull();
    expect(after.status).toBe("past_client");
    expect(await prisma.contactLabel.count({ where: { contactId: contact.id } })).toBe(1);
    expect(await prisma.memberLabel.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("keeps a hand-set status on a linked contact across boots", async () => {
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    orgId = (await prisma.organization.create({ data: { id: `cb5-org-${s}`, name: `cb5-${s}`, slug: `cb5-${s}` } })).id;
    orgIds.push(orgId);
    userIds.push(`cb5-client-${s}`);
    const client = await prisma.user.create({ data: { id: `cb5-client-${s}`, name: "Pax", email: `pax-${s}@x.com`, emailVerified: true } });
    await prisma.member.create({ data: { id: `cb5-m-c-${s}`, organizationId: orgId, userId: client.id, role: "member" } });

    await backfill.run();
    const contact = await prisma.contact.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(contact.status).toBe("client");
    await prisma.contact.update({ where: { id: contact.id }, data: { status: "past_client" } });

    await backfill.run();
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).status).toBe("past_client");
  });

  it("fills empty fields on a lead matched by email, keeps existing values, and re-copies after a partial run", async () => {
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    orgId = (await prisma.organization.create({ data: { id: `cb2-org-${s}`, name: `cb2-${s}`, slug: `cb2-${s}` } })).id;
    orgIds.push(orgId);
    userIds.push(`cb2-owner-${s}`, `cb2-client-${s}`);
    const owner = await prisma.user.create({ data: { id: `cb2-owner-${s}`, name: "Owner", email: `o2-${s}@x.com`, emailVerified: true } });
    const client = await prisma.user.create({ data: { id: `cb2-client-${s}`, name: "Lena", email: `lena-${s}@x.com`, emailVerified: true } });
    await prisma.member.create({ data: { id: `cb2-m-o-${s}`, organizationId: orgId, userId: owner.id, role: "owner" } });
    await prisma.member.create({ data: { id: `cb2-m-c-${s}`, organizationId: orgId, userId: client.id, role: "member" } });
    await prisma.contact.create({
      data: { organizationId: orgId, name: "Lena", email: client.email, status: "lead", phone: "111" },
    });
    await prisma.clientProfile.create({
      data: { userId: client.id, organizationId: orgId, phone: "999", website: "https://lena.dev", description: "Note" },
    });

    await backfill.run();

    const contact = await prisma.contact.findFirstOrThrow({ where: { organizationId: orgId }, include: { notes: true } });
    expect(contact.userId).toBe(client.id);
    expect(contact.phone).toBe("111");
    expect(contact.website).toBe("https://lena.dev");
    expect(contact.description).toBe("Note");
    expect(contact.notes).toHaveLength(0);

    expect(contact.profileImportedAt).not.toBeNull();
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).contactsBackfillVersion).toBe(1);

    // A user clears the website and About: later boots must not refill them.
    await prisma.contact.update({ where: { id: contact.id }, data: { website: null, description: "" } });
    await backfill.run();
    const cleared = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(cleared.website).toBeNull();
    expect(cleared.description).toBe("");

    // A failed/partial pass leaves profileImportedAt null and the workspace version behind, and is retried.
    await prisma.organization.update({ where: { id: orgId }, data: { contactsBackfillVersion: 0 } });
    await prisma.contact.update({
      where: { id: contact.id },
      data: { profileImportedAt: null, website: null, description: null },
    });
    await backfill.run();
    const retried = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id }, include: { notes: true } });
    expect(retried.website).toBe("https://lena.dev");
    expect(retried.phone).toBe("111");
    expect(retried.description).toBe("Note");
    expect(retried.notes).toHaveLength(0);
    expect(retried.profileImportedAt).not.toBeNull();
  });

  it("gives open portal invitations a contact once per workspace, and never brings one back", async () => {
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    orgId = (await prisma.organization.create({ data: { id: `cb9-org-${s}`, name: `cb9-${s}`, slug: `cb9-${s}` } })).id;
    orgIds.push(orgId);
    const inFuture = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const known = await prisma.contact.create({
      data: { organizationId: orgId, name: "Known", email: `known-${s}@x.com`, status: "client" },
    });
    await prisma.invitation.createMany({
      data: [
        { id: `cb9-i1-${s}`, organizationId: orgId, email: `New-${s}@X.com`, role: "member", status: "pending", expiresAt: inFuture, inviterId: "x" },
        { id: `cb9-i2-${s}`, organizationId: orgId, email: `KNOWN-${s}@x.com`, role: "member", status: "pending", expiresAt: inFuture, inviterId: "x" },
        { id: `cb9-i3-${s}`, organizationId: orgId, email: `old-${s}@x.com`, role: "member", status: "pending", expiresAt: new Date(Date.now() - 1000), inviterId: "x" },
        { id: `cb9-i4-${s}`, organizationId: orgId, email: `staff-${s}@x.com`, role: "admin", status: "pending", expiresAt: inFuture, inviterId: "x" },
        { id: `cb9-i5-${s}`, organizationId: orgId, email: `gone-${s}@x.com`, role: "member", status: "canceled", expiresAt: inFuture, inviterId: "x" },
      ],
    });

    await backfill.run();

    const contacts = await prisma.contact.findMany({ where: { organizationId: orgId }, orderBy: { email: "asc" } });
    expect(contacts.map((c) => [c.email, c.status, c.firstName])).toEqual([
      [`known-${s}@x.com`, "client", "Known"],
      [`new-${s}@x.com`, "lead", null],
    ]);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: known.id } })).name).toBe("Known");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).inviteesBackfilledAt).not.toBeNull();

    // The owner deletes the invite-only lead: later boots must not recreate it.
    await prisma.contact.deleteMany({ where: { organizationId: orgId, email: `new-${s}@x.com` } });
    await backfill.run();
    expect(await prisma.contact.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("copies the old profile description into About once, also for contacts imported earlier", async () => {
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    orgId = (await prisma.organization.create({ data: { id: `cb10-org-${s}`, name: `cb10-${s}`, slug: `cb10-${s}` } })).id;
    orgIds.push(orgId);
    userIds.push(`cb10-a-${s}`, `cb10-b-${s}`);
    const fresh = await prisma.user.create({ data: { id: `cb10-a-${s}`, name: "Fay", email: `fay-${s}@x.com`, emailVerified: true } });
    const earlier = await prisma.user.create({ data: { id: `cb10-b-${s}`, name: "Gus", email: `gus-${s}@x.com`, emailVerified: true } });
    await prisma.member.create({ data: { id: `cb10-m-a-${s}`, organizationId: orgId, userId: fresh.id, role: "member" } });
    await prisma.member.create({ data: { id: `cb10-m-b-${s}`, organizationId: orgId, userId: earlier.id, role: "member" } });
    await prisma.clientProfile.createMany({
      data: [
        { userId: fresh.id, organizationId: orgId, description: "Fay's shop" },
        { userId: earlier.id, organizationId: orgId, description: "Gus's studio" },
      ],
    });
    // Imported by an earlier version, before Contact.description existed.
    const gus = await prisma.contact.create({
      data: { organizationId: orgId, name: "Gus", email: earlier.email, userId: earlier.id, status: "client", profileImportedAt: new Date() },
    });

    await backfill.run();

    const fay = await prisma.contact.findFirstOrThrow({ where: { organizationId: orgId, userId: fresh.id } });
    expect(fay.description).toBe("Fay's shop");
    const gusAfter = await prisma.contact.findUniqueOrThrow({ where: { id: gus.id } });
    expect(gusAfter.description).toBe("Gus's studio");
    expect(gusAfter.updatedAt.getTime()).toBe(gus.updatedAt.getTime());

    // Cleared in the app (stored as ""): later boots leave it cleared.
    await prisma.contact.update({ where: { id: gus.id }, data: { description: "" } });
    await backfill.run();
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: gus.id } })).description).toBe("");
  });
});
