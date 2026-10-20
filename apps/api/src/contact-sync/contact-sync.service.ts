import { Injectable, Logger } from "@nestjs/common";
import type { Contact } from "@atrium/database";
import { PrismaService } from "../prisma/prisma.service";
import { calculateInvoiceTotal } from "../payments/invoice-total";

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

  private async addEvent(
    contactId: string,
    organizationId: string,
    type: string,
    detail: string,
    refId?: string,
  ): Promise<void> {
    await this.prisma.contactEvent.create({
      data: { contactId, organizationId, type, detail, ...(refId ? { refId } : {}) },
    });
  }

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
      if (byEmail.userId) {
        // Email is unique per workspace, so a new contact can't be created; leave it alone.
        this.logger.warn(
          `Contact ${byEmail.id} matches user ${userId} by email but is linked to another user; not relinking`,
        );
        return byEmail;
      }
      const updated = await this.prisma.contact.update({
        where: { id: byEmail.id },
        data: { userId, status: "client" },
      });
      await this.addEvent(byEmail.id, orgId, "portal_joined", "Joined the client portal");
      return updated;
    }

    const created = await this.prisma.contact.create({
      data: { organizationId: orgId, name: user.name, email, userId, status: "client" },
    });
    await this.addEvent(created.id, orgId, "contact_created", "Contact created");
    return created;
  }

  async linkProjectClients(projectId: string, orgId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const contacts: Contact[] = [];
    for (const userId of userIds) {
      const contact = await this.ensureForMember(orgId, userId);
      if (contact) contacts.push(contact);
    }
    if (contacts.length === 0) return;

    const existing = await this.prisma.projectContact.findMany({
      where: { projectId, contactId: { in: contacts.map((c) => c.id) } },
      select: { contactId: true },
    });
    const alreadyLinked = new Set(existing.map((l) => l.contactId));
    const fresh = contacts.filter((c) => !alreadyLinked.has(c.id));

    await this.prisma.projectContact.createMany({
      data: contacts.map((c) => ({ projectId, contactId: c.id })),
      skipDuplicates: true,
    });

    if (fresh.length === 0) return;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });
    for (const contact of fresh) {
      await this.addEvent(
        contact.id,
        orgId,
        "project_linked",
        `Linked to project "${project?.name ?? ""}"`,
        projectId,
      );
    }
  }

  async detachMember(orgId: string, userId: string): Promise<void> {
    await this.prisma.contact.updateMany({
      where: { organizationId: orgId, userId },
      data: { userId: null, status: "past_client" },
    });
  }

  /** Keeps the contact link in step with a role change: only role "member" is a portal client. */
  async syncRoleChange(orgId: string, userId: string, previousRole: string, newRole: string): Promise<void> {
    if (previousRole === newRole) return;
    if (newRole === "member") {
      await this.ensureForMember(orgId, userId);
    } else if (previousRole === "member") {
      await this.detachMember(orgId, userId);
    }
  }

  async detachUserEverywhere(userId: string): Promise<void> {
    await this.prisma.contact.updateMany({
      where: { userId },
      data: { userId: null, status: "past_client" },
    });
  }

  async recordInvited(orgId: string, email: string): Promise<void> {
    const contact = await this.prisma.contact.findFirst({
      where: { organizationId: orgId, email: normalizeEmail(email) },
    });
    if (!contact) return;
    await this.addEvent(contact.id, orgId, "portal_invited", "Invited to the client portal");
  }

  async recordInvoicePaid(invoiceId: string): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true, project: true },
    });
    if (!invoice?.projectId) return;

    const links = await this.prisma.projectContact.findMany({
      where: { projectId: invoice.projectId },
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
      await this.addEvent(contactId, invoice.organizationId, "invoice_paid", detail, invoice.id);
    }
  }
}
