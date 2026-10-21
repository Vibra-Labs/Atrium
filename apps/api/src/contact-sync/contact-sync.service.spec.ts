import { describe, expect, it, mock, beforeEach } from "bun:test";
import type { PrismaService } from "../prisma/prisma.service";
import { ContactSyncService, normalizeEmail } from "./contact-sync.service";

const mockPrisma = {
  user: { findUnique: mock(() => Promise.resolve(null as unknown)) },
  member: {
    findFirst: mock(() => Promise.resolve({ role: "member" } as unknown)),
    findMany: mock(() => Promise.resolve([] as unknown[])),
  },
  contact: {
    findFirst: mock(() => Promise.resolve(null as unknown)),
    findMany: mock(() => Promise.resolve([] as unknown[])),
    create: mock(() => Promise.resolve({ id: "c-new" } as unknown)),
    update: mock(() => Promise.resolve({ id: "c-1" } as unknown)),
    updateMany: mock(() => Promise.resolve({ count: 1 })),
  },
  contactEvent: {
    create: mock(() => Promise.resolve({})),
    createMany: mock(() => Promise.resolve({ count: 0 })),
    findMany: mock(() => Promise.resolve([] as unknown[])),
  },
  projectContact: {
    findMany: mock(() => Promise.resolve([] as unknown[])),
    createMany: mock(() => Promise.resolve({ count: 0 })),
    updateMany: mock((a: unknown) => Promise.resolve({ count: 0, a })),
  },
  project: { findUnique: mock(() => Promise.resolve({ id: "p-1", name: "Site" } as unknown)) },
  invoice: { findUnique: mock(() => Promise.resolve(null as unknown)) },
  memberLabel: {
    findMany: mock(() => Promise.resolve([] as unknown[])),
    deleteMany: mock((a: unknown) => Promise.resolve({ count: 0, a })),
  },
  contactLabel: { createMany: mock((a: unknown) => Promise.resolve({ count: 0, a })) },
  $transaction: mock((ops: unknown[]) => Promise.all(ops)),
};

function reset(): void {
  const { $transaction, ...models } = mockPrisma;
  $transaction.mockClear();
  const groups = Object.values(models) as Array<Record<string, ReturnType<typeof mock>>>;
  for (const group of groups) for (const fn of Object.values(group)) fn.mockClear();
  mockPrisma.memberLabel.findMany.mockImplementation(() => Promise.resolve([]));
  mockPrisma.contact.create.mockImplementation(() => Promise.resolve({ id: "c-new" }));
  mockPrisma.user.findUnique.mockImplementation(() => Promise.resolve(null));
  mockPrisma.member.findFirst.mockImplementation(() => Promise.resolve({ role: "member" }));
  mockPrisma.contact.findFirst.mockImplementation(() => Promise.resolve(null));
  mockPrisma.contactEvent.findMany.mockImplementation(() => Promise.resolve([]));
  mockPrisma.projectContact.findMany.mockImplementation(() => Promise.resolve([]));
  mockPrisma.member.findMany.mockImplementation(() => Promise.resolve([]));
  mockPrisma.contact.findMany.mockImplementation(() => Promise.resolve([]));
}

const bob = { id: "u-1", name: "Bob", email: "bob@x.com" };

describe("ContactSyncService", () => {
  let service: ContactSyncService;

  beforeEach(() => {
    reset();
    service = new ContactSyncService(mockPrisma as unknown as PrismaService);
  });

  it("normalizeEmail trims and lowercases", () => {
    expect(normalizeEmail("  Bob@X.com ")).toBe("bob@x.com");
  });

  describe("ensureForMember", () => {
    it("links an existing lead by email case-insensitively", async () => {
      mockPrisma.user.findUnique.mockImplementation(() =>
        Promise.resolve({ ...bob, email: "Bob@X.com " }),
      );
      const lead = { id: "c-1", email: "bob@x.com", userId: null, status: "lead" };
      mockPrisma.contact.findFirst
        .mockImplementationOnce(() => Promise.resolve(null)) // by userId
        .mockImplementationOnce(() => Promise.resolve(lead)); // by email

      await service.ensureForMember("org-1", "u-1");

      expect(mockPrisma.contact.findFirst.mock.calls[1][0]).toEqual({
        where: { organizationId: "org-1", email: "bob@x.com" },
      });
      expect(mockPrisma.contact.update).toHaveBeenCalledWith({
        where: { id: "c-1" },
        data: { userId: "u-1", status: "client" },
      });
      expect(mockPrisma.contactEvent.create).toHaveBeenCalledWith({
        data: {
          contactId: "c-1",
          organizationId: "org-1",
          type: "portal_joined",
          detail: "Joined the client portal",
        },
      });
      expect(mockPrisma.contact.create).not.toHaveBeenCalled();
    });

    it("creates a client contact when none exists", async () => {
      mockPrisma.user.findUnique.mockImplementation(() =>
        Promise.resolve({ ...bob, name: " Bob Van Dyke ", email: "Bob@X.com" }),
      );

      await service.ensureForMember("org-1", "u-1");

      expect(mockPrisma.contact.create).toHaveBeenCalledWith({
        data: {
          organizationId: "org-1",
          name: "Bob Van Dyke",
          firstName: "Bob",
          lastName: "Van Dyke",
          email: "bob@x.com",
          userId: "u-1",
          status: "client",
        },
      });
      expect(mockPrisma.contactEvent.create).toHaveBeenCalledWith({
        data: {
          contactId: "c-new",
          organizationId: "org-1",
          type: "contact_created",
          detail: "Contact created",
        },
      });
    });

    it("is a no-op when already linked", async () => {
      mockPrisma.user.findUnique.mockImplementation(() => Promise.resolve(bob));
      mockPrisma.contact.findFirst.mockImplementation(() =>
        Promise.resolve({ id: "c-1", userId: "u-1", status: "client" }),
      );

      const result = await service.ensureForMember("org-1", "u-1");

      expect(result).toEqual({ id: "c-1", userId: "u-1", status: "client" });
      expect(mockPrisma.contact.update).not.toHaveBeenCalled();
      expect(mockPrisma.contact.create).not.toHaveBeenCalled();
      expect(mockPrisma.contactEvent.create).not.toHaveBeenCalled();
    });

    it("keeps a hand-set status on an already-linked contact", async () => {
      mockPrisma.user.findUnique.mockImplementation(() => Promise.resolve(bob));
      const linked = { id: "c-1", userId: "u-1", status: "past_client" };
      mockPrisma.contact.findFirst.mockImplementation(() => Promise.resolve(linked));

      const result = await service.ensureForMember("org-1", "u-1");

      expect(result).toEqual(linked);
      expect(mockPrisma.contact.update).not.toHaveBeenCalled();
      expect(mockPrisma.contactEvent.create).not.toHaveBeenCalled();
    });

    it("does not take over an email match linked to another user", async () => {
      mockPrisma.user.findUnique.mockImplementation(() => Promise.resolve(bob));
      const other = { id: "c-9", email: "bob@x.com", userId: "u-other", status: "client" };
      mockPrisma.contact.findFirst
        .mockImplementationOnce(() => Promise.resolve(null)) // by userId
        .mockImplementationOnce(() => Promise.resolve(other)); // by email

      const result = await service.ensureForMember("org-1", "u-1");

      expect(result).toBeNull();
      expect(mockPrisma.contact.update).not.toHaveBeenCalled();
      expect(mockPrisma.contact.create).not.toHaveBeenCalled();
      expect(mockPrisma.contactEvent.create).not.toHaveBeenCalled();
    });

    it("returns the winner when a concurrent create races it (P2002)", async () => {
      mockPrisma.user.findUnique.mockImplementation(() => Promise.resolve(bob));
      const winner = { id: "c-won", email: "bob@x.com", userId: "u-1", status: "client" };
      mockPrisma.contact.findFirst
        .mockImplementationOnce(() => Promise.resolve(null)) // by userId
        .mockImplementationOnce(() => Promise.resolve(null)) // by email
        .mockImplementationOnce(() => Promise.resolve(winner)); // refetch by userId
      mockPrisma.contact.create.mockImplementationOnce(() => Promise.reject({ code: "P2002" }));

      const result = await service.ensureForMember("org-1", "u-1");

      expect(result).toEqual(winner);
      expect(mockPrisma.contact.findFirst.mock.calls[2][0]).toEqual({
        where: { organizationId: "org-1", userId: "u-1" },
      });
      expect(mockPrisma.contactEvent.create).not.toHaveBeenCalled();
    });

    it("after a P2002 race, falls back to the email match and refuses one linked to another user", async () => {
      mockPrisma.user.findUnique.mockImplementation(() => Promise.resolve(bob));
      const lead = { id: "c-lead", email: "bob@x.com", userId: null, status: "lead" };
      mockPrisma.contact.findFirst
        .mockImplementationOnce(() => Promise.resolve(null))
        .mockImplementationOnce(() => Promise.resolve(null))
        .mockImplementationOnce(() => Promise.resolve(null)) // refetch by userId
        .mockImplementationOnce(() => Promise.resolve(lead)); // refetch by email
      mockPrisma.contact.create.mockImplementationOnce(() => Promise.reject({ code: "P2002" }));
      expect(await service.ensureForMember("org-1", "u-1")).toEqual(lead);
      expect(mockPrisma.contact.findFirst.mock.calls[3][0]).toEqual({
        where: { organizationId: "org-1", email: "bob@x.com" },
      });

      const taken = { ...lead, userId: "u-other" };
      mockPrisma.contact.findFirst
        .mockImplementationOnce(() => Promise.resolve(null))
        .mockImplementationOnce(() => Promise.resolve(null))
        .mockImplementationOnce(() => Promise.resolve(null))
        .mockImplementationOnce(() => Promise.resolve(taken));
      mockPrisma.contact.create.mockImplementationOnce(() => Promise.reject({ code: "P2002" }));
      expect(await service.ensureForMember("org-1", "u-1")).toBeNull();
    });

    it("rethrows non-unique create errors", async () => {
      mockPrisma.user.findUnique.mockImplementation(() => Promise.resolve(bob));
      mockPrisma.contact.create.mockImplementationOnce(() => Promise.reject(new Error("db down")));
      await expect(service.ensureForMember("org-1", "u-1")).rejects.toThrow("db down");
    });

    it("is a no-op for staff (owner/admin) and non-members", async () => {
      mockPrisma.user.findUnique.mockImplementation(() => Promise.resolve(bob));
      for (const member of [{ role: "admin" }, { role: "owner" }, null]) {
        mockPrisma.member.findFirst.mockImplementation(() => Promise.resolve(member));
        const result = await service.ensureForMember("org-1", "u-1");
        expect(result).toBeNull();
      }
      expect(mockPrisma.member.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org-1", userId: "u-1" },
        select: { role: true },
      });
      expect(mockPrisma.contact.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.contact.create).not.toHaveBeenCalled();
      expect(mockPrisma.contact.update).not.toHaveBeenCalled();
    });
  });

  describe("linkProjectClients", () => {
    const contact = (n: number) => ({ id: `c-${n}`, userId: `u-${n}`, status: "client" });

    beforeEach(() => {
      mockPrisma.member.findMany.mockImplementation(() => Promise.resolve([{ userId: "u-1" }]));
      mockPrisma.contact.findMany.mockImplementation(() => Promise.resolve([contact(1)]));
    });

    it("uses createMany skipDuplicates and logs new links", async () => {
      await service.linkProjectClients("p-1", "org-1", ["u-1"]);

      expect(mockPrisma.projectContact.createMany).toHaveBeenCalledWith({
        data: [{ projectId: "p-1", contactId: "c-1" }],
        skipDuplicates: true,
      });
      expect(mockPrisma.contactEvent.createMany).toHaveBeenCalledWith({
        data: [
          {
            contactId: "c-1",
            organizationId: "org-1",
            type: "project_linked",
            detail: 'Linked to project "Site"',
            refId: "p-1",
          },
        ],
      });
    });

    it("looks clients up in bulk and writes one event insert for many clients", async () => {
      mockPrisma.member.findMany.mockImplementation(() =>
        Promise.resolve([{ userId: "u-1" }, { userId: "u-2" }, { userId: "u-3" }]),
      );
      mockPrisma.contact.findMany.mockImplementation(() => Promise.resolve([contact(1), contact(2), contact(3)]));

      await service.linkProjectClients("p-1", "org-1", ["u-1", "u-2", "u-3", "u-staff"]);

      expect(mockPrisma.member.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.contact.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.member.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.contact.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.contactEvent.create).not.toHaveBeenCalled();
      expect(mockPrisma.contactEvent.createMany).toHaveBeenCalledTimes(1);
      const call = mockPrisma.contactEvent.createMany.mock.calls[0] as unknown as [{ data: unknown[] }];
      expect(call[0].data).toHaveLength(3);
    });

    it("creates a contact only for clients that have none", async () => {
      mockPrisma.member.findMany.mockImplementation(() => Promise.resolve([{ userId: "u-1" }, { userId: "u-2" }]));
      mockPrisma.user.findUnique.mockImplementation(() => Promise.resolve({ id: "u-2", name: "Cy", email: "cy@x.com" }));

      await service.linkProjectClients("p-1", "org-1", ["u-1", "u-2"]);

      expect(mockPrisma.contact.create).toHaveBeenCalledTimes(1);
      const call = mockPrisma.projectContact.createMany.mock.calls[0] as unknown as [{ data: unknown[] }];
      expect(call[0].data).toHaveLength(2);
    });

    it("skips staff users", async () => {
      mockPrisma.member.findMany.mockImplementation(() => Promise.resolve([]));

      await service.linkProjectClients("p-1", "org-1", ["u-1"]);

      expect(mockPrisma.projectContact.createMany).not.toHaveBeenCalled();
      expect(mockPrisma.contactEvent.createMany).not.toHaveBeenCalled();
    });

    it("does not log an event for an already-linked contact", async () => {
      mockPrisma.projectContact.findMany.mockImplementation(() =>
        Promise.resolve([{ contactId: "c-1" }]),
      );

      await service.linkProjectClients("p-1", "org-1", ["u-1"]);

      expect(mockPrisma.contactEvent.createMany).not.toHaveBeenCalled();
      expect(mockPrisma.projectContact.updateMany).not.toHaveBeenCalled();
    });

    it("reopens an ended link and logs it like a new one", async () => {
      mockPrisma.projectContact.findMany.mockImplementation(() =>
        Promise.resolve([{ contactId: "c-1", endedAt: new Date("2026-01-01") }]),
      );

      await service.linkProjectClients("p-1", "org-1", ["u-1"]);

      expect(mockPrisma.projectContact.updateMany).toHaveBeenCalledWith({
        where: { projectId: "p-1", contactId: { in: ["c-1"] } },
        data: { endedAt: null },
      });
      expect(mockPrisma.contactEvent.createMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("endProjectClients", () => {
    it("ends only the open links of those clients on that project", async () => {
      await service.endProjectClients("p-1", "org-1", ["u-1", "u-2"]);
      const call = mockPrisma.projectContact.updateMany.mock.calls[0] as unknown as [
        { where: unknown; data: { endedAt: Date } },
      ];
      expect(call[0].where).toEqual({
        projectId: "p-1",
        endedAt: null,
        contact: { organizationId: "org-1", userId: { in: ["u-1", "u-2"] } },
      });
      expect(call[0].data.endedAt).toBeInstanceOf(Date);
    });

    it("does nothing for no clients", async () => {
      await service.endProjectClients("p-1", "org-1", []);
      expect(mockPrisma.projectContact.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("detachMember", () => {
    it("ends the contact's project links, then clears userId and sets past_client", async () => {
      await service.detachMember("org-1", "u-1");
      const ended = mockPrisma.projectContact.updateMany.mock.calls[0] as unknown as [{ where: unknown }];
      expect(ended[0].where).toEqual({ endedAt: null, contact: { organizationId: "org-1", userId: "u-1" } });
      expect(mockPrisma.contact.updateMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", userId: "u-1" },
        data: { userId: null, status: "past_client" },
      });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("syncRoleChange", () => {
    it("detaches the contact when a client is promoted to staff", async () => {
      await service.syncRoleChange("org-1", "u-1", "member", "admin");
      expect(mockPrisma.contact.updateMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", userId: "u-1" },
        data: { userId: null, status: "past_client" },
      });
    });

    it("ensures a contact when staff is demoted to client", async () => {
      mockPrisma.user.findUnique.mockImplementation(() => Promise.resolve(bob));
      await service.syncRoleChange("org-1", "u-1", "owner", "member");
      expect(mockPrisma.contact.create).toHaveBeenCalled();
      expect(mockPrisma.contact.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("moves staff tags onto the new contact when staff is demoted to client", async () => {
      mockPrisma.user.findUnique.mockImplementation(() => Promise.resolve(bob));
      mockPrisma.memberLabel.findMany.mockImplementation(() =>
        Promise.resolve([
          { id: "ml-1", labelId: "l-1" },
          { id: "ml-2", labelId: "l-2" },
        ]),
      );

      await service.syncRoleChange("org-1", "u-1", "admin", "member");

      expect(mockPrisma.memberLabel.findMany).toHaveBeenCalledWith({
        where: { member: { organizationId: "org-1", userId: "u-1" } },
        select: { id: true, labelId: true },
      });
      expect(mockPrisma.contactLabel.createMany).toHaveBeenCalledWith({
        data: [
          { contactId: "c-new", labelId: "l-1" },
          { contactId: "c-new", labelId: "l-2" },
        ],
        skipDuplicates: true,
      });
      expect(mockPrisma.memberLabel.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["ml-1", "ml-2"] } },
      });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("leaves a promoted client's tags on their contact", async () => {
      await service.syncRoleChange("org-1", "u-1", "member", "owner");
      expect(mockPrisma.memberLabel.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.contactLabel.createMany).not.toHaveBeenCalled();
      expect(mockPrisma.memberLabel.deleteMany).not.toHaveBeenCalled();
    });

    it("does nothing between staff roles or for an unchanged role", async () => {
      await service.syncRoleChange("org-1", "u-1", "admin", "owner");
      await service.syncRoleChange("org-1", "u-1", "member", "member");
      expect(mockPrisma.contact.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.member.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("detachUserEverywhere", () => {
    it("clears the user across all orgs", async () => {
      await service.detachUserEverywhere("u-1");
      const ended = mockPrisma.projectContact.updateMany.mock.calls[0] as unknown as [{ where: unknown }];
      expect(ended[0].where).toEqual({ endedAt: null, contact: { userId: "u-1" } });
      expect(mockPrisma.contact.updateMany).toHaveBeenCalledWith({
        where: { userId: "u-1" },
        data: { userId: null, status: "past_client" },
      });
    });
  });

  describe("recordInvited", () => {
    it("adds a portal_invited event when the contact exists", async () => {
      mockPrisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1", status: "client" }));
      await service.recordInvited("org-1", " Bob@X.com", "member");
      expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org-1", email: "bob@x.com" },
      });
      expect(mockPrisma.contact.create).not.toHaveBeenCalled();
      expect(mockPrisma.contact.update).not.toHaveBeenCalled();
      expect(mockPrisma.contactEvent.create).toHaveBeenCalledWith({
        data: {
          contactId: "c-1",
          organizationId: "org-1",
          type: "portal_invited",
          detail: "Invited to the client portal",
        },
      });
    });

    it("creates a lead named after the email when no contact matches", async () => {
      await service.recordInvited("org-1", " New@X.com ", "member");
      expect(mockPrisma.contact.create).toHaveBeenCalledWith({
        data: {
          organizationId: "org-1",
          name: "new@x.com",
          email: "new@x.com",
          status: "lead",
        },
      });
      const types = mockPrisma.contactEvent.create.mock.calls.map(
        (c) => (c as unknown as [{ data: { type: string; contactId: string } }])[0].data,
      );
      expect(types).toEqual([
        expect.objectContaining({ contactId: "c-new", type: "contact_created" }),
        expect.objectContaining({ contactId: "c-new", type: "portal_invited" }),
      ]);
    });

    it("returns the concurrent winner when the create races", async () => {
      let calls = 0;
      mockPrisma.contact.findFirst.mockImplementation(() =>
        Promise.resolve(calls++ === 0 ? null : { id: "c-won" }),
      );
      mockPrisma.contact.create.mockImplementation(() => Promise.reject({ code: "P2002" }));
      await service.recordInvited("org-1", "race@x.com", "member");
      expect(mockPrisma.contactEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ contactId: "c-won", type: "portal_invited" }),
      });
    });

    it("ignores staff invitations", async () => {
      await service.recordInvited("org-1", "staff@x.com", "admin");
      expect(mockPrisma.contact.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.contact.create).not.toHaveBeenCalled();
      expect(mockPrisma.contactEvent.create).not.toHaveBeenCalled();
    });
  });

  describe("ensureForMember after an invitation", () => {
    it("renames a contact still named after its email to the user's name", async () => {
      mockPrisma.user.findUnique.mockImplementation(() =>
        Promise.resolve({ id: "u-1", name: "Bob Stone", email: "bob@x.com" }),
      );
      let calls = 0;
      mockPrisma.contact.findFirst.mockImplementation(() =>
        Promise.resolve(calls++ === 0 ? null : { id: "c-1", name: "bob@x.com", userId: null }),
      );
      await service.ensureForMember("org-1", "u-1");
      expect(mockPrisma.contact.update).toHaveBeenCalledWith({
        where: { id: "c-1" },
        data: { userId: "u-1", status: "client", name: "Bob Stone", firstName: "Bob", lastName: "Stone" },
      });
    });

    it("keeps a contact's own name", async () => {
      mockPrisma.user.findUnique.mockImplementation(() =>
        Promise.resolve({ id: "u-1", name: "Bob Stone", email: "bob@x.com" }),
      );
      let calls = 0;
      mockPrisma.contact.findFirst.mockImplementation(() =>
        Promise.resolve(calls++ === 0 ? null : { id: "c-1", name: "Robert", userId: null }),
      );
      await service.ensureForMember("org-1", "u-1");
      expect(mockPrisma.contact.update).toHaveBeenCalledWith({
        where: { id: "c-1" },
        data: { userId: "u-1", status: "client" },
      });
    });
  });

  describe("recordInvoicePaid", () => {
    const invoice = {
      id: "inv-1",
      invoiceNumber: "INV-0042",
      organizationId: "org-1",
      projectId: "p-1",
      type: "uploaded",
      amount: 400000,
      paidAmount: null,
      lineItems: [],
    };

    it("writes one event per linked contact and skips duplicates", async () => {
      mockPrisma.invoice.findUnique.mockImplementation(() => Promise.resolve(invoice));
      mockPrisma.projectContact.findMany.mockImplementation(() =>
        Promise.resolve([{ contactId: "c-1" }, { contactId: "c-2" }]),
      );
      mockPrisma.contactEvent.findMany.mockImplementation(() =>
        Promise.resolve([{ contactId: "c-1" }]),
      );

      await service.recordInvoicePaid("inv-1");

      expect(mockPrisma.contactEvent.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.contactEvent.create).toHaveBeenCalledWith({
        data: {
          contactId: "c-2",
          organizationId: "org-1",
          type: "invoice_paid",
          detail: "Invoice INV-0042 paid · $4,000.00",
          refId: "inv-1",
        },
      });
    });

    it("prefers paidAmount over the computed total", async () => {
      mockPrisma.invoice.findUnique.mockImplementation(() =>
        Promise.resolve({ ...invoice, paidAmount: 123456789 }),
      );
      mockPrisma.projectContact.findMany.mockImplementation(() =>
        Promise.resolve([{ contactId: "c-1" }]),
      );

      await service.recordInvoicePaid("inv-1");

      const arg = mockPrisma.contactEvent.create.mock.calls[0][0] as { data: { detail: string } };
      expect(arg.data.detail).toBe("Invoice INV-0042 paid · $1,234,567.89");
    });

    it("ignores invoices without a project", async () => {
      mockPrisma.invoice.findUnique.mockImplementation(() =>
        Promise.resolve({ ...invoice, projectId: null }),
      );
      await service.recordInvoicePaid("inv-1");
      expect(mockPrisma.projectContact.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.contactEvent.create).not.toHaveBeenCalled();
    });
  });
});
