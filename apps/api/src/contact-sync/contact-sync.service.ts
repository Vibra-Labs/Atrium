import { Injectable } from "@nestjs/common";
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

  async ensureForMember(orgId: string, userId: string): Promise<Contact> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error(`User ${userId} not found`);

    const linked = await this.prisma.contact.findFirst({
      where: { organizationId: orgId, userId },
    });
    if (linked) {
      if (linked.status === "client") return linked;
      return this.prisma.contact.update({
        where: { id: linked.id },
        data: { status: "client" },
      });
    }

    const email = normalizeEmail(user.email);
    const byEmail = await this.prisma.contact.findFirst({
      where: { organizationId: orgId, email },
    });
    if (byEmail) {
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
      contacts.push(await this.ensureForMember(orgId, userId));
    }

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
