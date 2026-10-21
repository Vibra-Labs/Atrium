import { Injectable, Logger } from "@nestjs/common";
import type { Contact } from "@atrium/database";
import { PrismaService } from "../prisma/prisma.service";
import { isPortalInviteRole } from "../clients/invitations";
import { calculateInvoiceTotal } from "../payments/invoice-total";
import { splitName } from "../contacts/contact-fields";
import { isPrismaUniqueViolation } from "../common/helpers/prisma-errors";
import { addContactEvent } from "./contact-events";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

@Injectable()
export class ContactSyncService {
  private readonly logger = new Logger(ContactSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gives a portal client (role "member") a contact linked to their user. Staff and non-members
   * get null. An existing linked contact is returned unchanged so a hand-set status sticks.
   */
  async ensureForMember(orgId: string, userId: string): Promise<Contact | null> {
    const member = await this.prisma.member.findFirst({
      where: { organizationId: orgId, userId },
      select: { role: true },
    });
    if (member?.role !== "member") return null;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error(`User ${userId} not found`);

    const linked = await this.prisma.contact.findFirst({
      where: { organizationId: orgId, userId },
    });
    if (linked) return linked;

    const email = normalizeEmail(user.email);
    const byEmail = await this.prisma.contact.findFirst({
      where: { organizationId: orgId, email },
    });
    if (byEmail) {
      // Email is unique per workspace, so a new contact can't be created; leave it alone.
      if (byEmail.userId) return this.refuseTaken(byEmail, userId);
      // A contact made from an invitation is named after the email until the person joins.
      const named =
        byEmail.name === email && user.name.trim()
          ? { name: user.name.trim(), ...splitName(user.name) }
          : {};
      const updated = await this.prisma.contact.update({
        where: { id: byEmail.id },
        data: { userId, status: "client", ...named },
      });
      await addContactEvent(this.prisma, byEmail.id, orgId, "portal_joined", "Joined the client portal");
      return updated;
    }

    let created: Contact;
    try {
      created = await this.prisma.contact.create({
        data: {
          organizationId: orgId,
          name: user.name.trim(),
          ...splitName(user.name),
          email,
          userId,
          status: "client",
        },
      });
    } catch (err) {
      if (!isPrismaUniqueViolation(err)) throw err;
      // A concurrent call created it first; return what won.
      const winner =
        (await this.prisma.contact.findFirst({ where: { organizationId: orgId, userId } })) ??
        (await this.prisma.contact.findFirst({ where: { organizationId: orgId, email } }));
      if (winner?.userId && winner.userId !== userId) return this.refuseTaken(winner, userId);
      return winner;
    }
    await addContactEvent(this.prisma, created.id, orgId, "contact_created", "Contact created");
    return created;
  }

  private refuseTaken(contact: Contact, userId: string): null {
    this.logger.warn(
      `Contact ${contact.id} matches user ${userId} by email but is linked to another user; not relinking`,
    );
    return null;
  }

  /** Moves a member's own (staff) tags onto their contact, e.g. after a demotion to client. */
  private async moveMemberLabels(orgId: string, userId: string, contactId: string): Promise<void> {
    const rows = await this.prisma.memberLabel.findMany({
      where: { member: { organizationId: orgId, userId } },
      select: { id: true, labelId: true },
    });
    if (rows.length === 0) return;
    await this.prisma.$transaction([
      this.prisma.contactLabel.createMany({
        data: rows.map((r) => ({ contactId, labelId: r.labelId })),
        skipDuplicates: true,
      }),
      this.prisma.memberLabel.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }),
    ]);
  }

  async linkProjectClients(projectId: string, orgId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    // Two queries for the whole list; ensureForMember (3 queries each) only for clients with no contact yet.
    const clients = await this.prisma.member.findMany({
      where: { organizationId: orgId, userId: { in: userIds }, role: "member" },
      select: { userId: true },
    });
    const clientIds = clients.map((m) => m.userId);
    if (clientIds.length === 0) return;
    const linked = await this.prisma.contact.findMany({
      where: { organizationId: orgId, userId: { in: clientIds } },
    });
    const contacts: Contact[] = [...linked];
    const haveContact = new Set(linked.map((c) => c.userId));
    for (const userId of clientIds) {
      if (haveContact.has(userId)) continue;
      const contact = await this.ensureForMember(orgId, userId);
      if (contact) contacts.push(contact);
    }
    if (contacts.length === 0) return;

    const existing = await this.prisma.projectContact.findMany({
      where: { projectId, contactId: { in: contacts.map((c) => c.id) } },
      select: { contactId: true, endedAt: true },
    });
    const alreadyLinked = new Set(existing.filter((l) => !l.endedAt).map((l) => l.contactId));
    const ended = existing.filter((l) => l.endedAt).map((l) => l.contactId);
    // A client put back on the project gets a fresh link (and event), like a first-time client.
    const fresh = contacts.filter((c) => !alreadyLinked.has(c.id));

    await this.prisma.projectContact.createMany({
      data: contacts.map((c) => ({ projectId, contactId: c.id })),
      skipDuplicates: true,
    });
    if (ended.length > 0) {
      await this.prisma.projectContact.updateMany({
        where: { projectId, contactId: { in: ended } },
        data: { endedAt: null },
      });
    }

    if (fresh.length === 0) return;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });
    await this.prisma.contactEvent.createMany({
      data: fresh.map((c) => ({
        contactId: c.id,
        organizationId: orgId,
        type: "project_linked",
        detail: `Linked to project "${project?.name ?? ""}"`,
        refId: projectId,
      })),
    });
  }

  /**
   * Ends the project links of clients taken off a project, so invoices paid after this no longer
   * count toward them. Earlier invoices still do.
   */
  async endProjectClients(projectId: string, orgId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.prisma.projectContact.updateMany({
      where: { projectId, endedAt: null, contact: { organizationId: orgId, userId: { in: userIds } } },
      data: { endedAt: new Date() },
    });
  }

  /** A client who leaves the workspace is a past client: their project links end, then the user link goes. */
  async detachMember(orgId: string, userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.projectContact.updateMany({
        where: { endedAt: null, contact: { organizationId: orgId, userId } },
        data: { endedAt: new Date() },
      }),
      this.prisma.contact.updateMany({
        where: { organizationId: orgId, userId },
        data: { userId: null, status: "past_client" },
      }),
    ]);
  }

  /**
   * Keeps the contact link in step with a role change: only role "member" is a portal client.
   * A demoted staff member's tags move to their contact; a promoted client's tags stay on the
   * contact, which is now a past-client record.
   */
  async syncRoleChange(orgId: string, userId: string, previousRole: string, newRole: string): Promise<void> {
    if (previousRole === newRole) return;
    if (newRole === "member") {
      const contact = await this.ensureForMember(orgId, userId);
      if (contact) await this.moveMemberLabels(orgId, userId, contact.id);
    } else if (previousRole === "member") {
      await this.detachMember(orgId, userId);
    }
  }

  async detachUserEverywhere(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.projectContact.updateMany({
        where: { endedAt: null, contact: { userId } },
        data: { endedAt: new Date() },
      }),
      this.prisma.contact.updateMany({
        where: { userId },
        data: { userId: null, status: "past_client" },
      }),
    ]);
  }

  /**
   * Every portal (role "member") invitation has a contact: the one with the invitee's email, or a
   * new lead named after the email until they accept. Staff invitations are not contacts.
   */
  async recordInvited(orgId: string, email: string, role: string | null | undefined): Promise<void> {
    if (!isPortalInviteRole(role)) return;
    const contact = await this.ensureForInvitee(orgId, email);
    await addContactEvent(this.prisma, contact.id, orgId, "portal_invited", "Invited to the client portal");
  }

  /** Finds the contact for an invitee's email, creating a lead if there is none. Status is left alone. */
  async ensureForInvitee(orgId: string, rawEmail: string): Promise<Contact> {
    const email = normalizeEmail(rawEmail);
    const existing = await this.prisma.contact.findFirst({ where: { organizationId: orgId, email } });
    if (existing) return existing;
    let created: Contact;
    try {
      created = await this.prisma.contact.create({
        // No first name: the email stands in as the name until they join (ensureForMember renames).
        data: { organizationId: orgId, name: email, email, status: "lead" },
      });
    } catch (err) {
      if (!isPrismaUniqueViolation(err)) throw err;
      // A concurrent call created it first.
      const winner = await this.prisma.contact.findFirst({ where: { organizationId: orgId, email } });
      if (!winner) throw err;
      return winner;
    }
    await addContactEvent(this.prisma, created.id, orgId, "contact_created", "Contact created");
    return created;
  }

  async recordInvoicePaid(invoiceId: string): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true, project: true },
    });
    if (!invoice?.projectId) return;

    const links = await this.prisma.projectContact.findMany({
      // Same rule as revenue: an ended link only gets invoices paid until it ended.
      where: {
        projectId: invoice.projectId,
        OR: [{ endedAt: null }, ...(invoice.paidAt ? [{ endedAt: { gte: invoice.paidAt } }] : [])],
      },
      select: { contactId: true },
    });
    if (links.length === 0) return;

    const done = await this.prisma.contactEvent.findMany({
      where: {
        type: "invoice_paid",
        refId: invoice.id,
        contactId: { in: links.map((l) => l.contactId) },
      },
      select: { contactId: true },
    });
    const skip = new Set(done.map((e) => e.contactId));
    const amount = invoice.paidAmount ?? calculateInvoiceTotal(invoice);
    const detail = `Invoice ${invoice.invoiceNumber} paid · ${formatDollars(amount)}`;

    for (const { contactId } of links) {
      if (skip.has(contactId)) continue;
      await addContactEvent(this.prisma, contactId, invoice.organizationId, "invoice_paid", detail, invoice.id);
    }
  }
}
