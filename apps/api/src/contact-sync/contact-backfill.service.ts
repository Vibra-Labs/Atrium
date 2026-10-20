import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { calculateInvoiceTotal } from "../payments/invoice-total";
import { ContactSyncService, normalizeEmail } from "./contact-sync.service";

const DEFAULT_LEAD_SOURCES: string[] = ["Referral", "Website", "Event", "Social"];

/** Turns existing clients, project links, labels and paid invoices into contact data. Idempotent. */
@Injectable()
export class ContactBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ContactBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: ContactSyncService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.error("Failed to backfill contacts", err);
    }
  }

  async run(): Promise<void> {
    const orgs: { id: string }[] = await this.prisma.organization.findMany({ select: { id: true } });
    for (const org of orgs) {
      try {
        await this.backfillOrg(org.id);
      } catch (err) {
        this.logger.error(`Failed to backfill contacts for organization ${org.id}`, err);
      }
    }
  }

  private async backfillOrg(orgId: string): Promise<void> {
    await this.prisma.leadSource.createMany({
      data: DEFAULT_LEAD_SOURCES.map((name) => ({ organizationId: orgId, name })),
      skipDuplicates: true,
    });

    await this.backfillMembers(orgId);
    await this.backfillProjectLinks(orgId);
    await this.backfillLabels(orgId);
    await this.backfillPaidInvoices(orgId);
  }

  private async backfillMembers(orgId: string): Promise<void> {
    const members = await this.prisma.member.findMany({
      where: { organizationId: orgId, role: "member" },
      include: { user: true },
    });
    for (const member of members) {
      try {
        const existing = await this.prisma.contact.findFirst({
          where: {
            organizationId: orgId,
            OR: [{ userId: member.userId }, { email: normalizeEmail(member.user.email) }],
          },
          select: { id: true },
        });
        const contact = await this.sync.ensureForMember(orgId, member.userId);
        if (!existing) await this.copyProfile(orgId, member.userId, contact.id);
      } catch (err) {
        this.logger.error(`Failed to backfill contact for member ${member.id}`, err);
      }
    }
  }

  private async copyProfile(orgId: string, userId: string, contactId: string): Promise<void> {
    const profile = await this.prisma.clientProfile.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
    });
    if (!profile) return;

    const companyName = profile.company?.trim();
    const companyId = companyName ? await this.findOrCreateCompany(orgId, companyName) : null;

    await this.prisma.contact.update({
      where: { id: contactId },
      data: {
        phone: profile.phone,
        address: profile.address,
        website: profile.website,
        ...(companyId ? { companyId } : {}),
      },
    });

    const description = profile.description?.trim();
    if (!description) return;
    const owner = await this.prisma.member.findFirst({
      where: { organizationId: orgId, role: "owner" },
      orderBy: { createdAt: "asc" },
    });
    if (!owner) return;
    await this.prisma.contactNote.create({
      data: { contactId, organizationId: orgId, authorId: owner.userId, content: description },
    });
  }

  private async findOrCreateCompany(orgId: string, name: string): Promise<string> {
    const existing = await this.prisma.company.findFirst({
      where: { organizationId: orgId, name: { equals: name, mode: "insensitive" } },
    });
    if (existing) return existing.id;
    const created = await this.prisma.company.create({ data: { organizationId: orgId, name } });
    return created.id;
  }

  private async backfillProjectLinks(orgId: string): Promise<void> {
    const links = await this.prisma.projectClient.findMany({
      where: { project: { organizationId: orgId } },
      select: { projectId: true, userId: true },
    });
    if (links.length === 0) return;
    const contacts = await this.prisma.contact.findMany({
      where: { organizationId: orgId, userId: { in: links.map((l) => l.userId) } },
      select: { id: true, userId: true },
    });
    const byUser = new Map(contacts.map((c) => [c.userId, c.id]));
    const data = links.flatMap((l) => {
      const contactId = byUser.get(l.userId);
      return contactId ? [{ projectId: l.projectId, contactId }] : [];
    });
    await this.prisma.projectContact.createMany({ data, skipDuplicates: true });
  }

  private async backfillLabels(orgId: string): Promise<void> {
    const memberLabels = await this.prisma.memberLabel.findMany({
      where: { member: { organizationId: orgId } },
      select: { labelId: true, member: { select: { userId: true } } },
    });
    if (memberLabels.length === 0) return;
    const contacts = await this.prisma.contact.findMany({
      where: { organizationId: orgId, userId: { in: memberLabels.map((m) => m.member.userId) } },
      select: { id: true, userId: true },
    });
    const byUser = new Map(contacts.map((c) => [c.userId, c.id]));
    const data = memberLabels.flatMap((m) => {
      const contactId = byUser.get(m.member.userId);
      return contactId ? [{ contactId, labelId: m.labelId }] : [];
    });
    await this.prisma.contactLabel.createMany({ data, skipDuplicates: true });
  }

  private async backfillPaidInvoices(orgId: string): Promise<void> {
    const unstamped = await this.prisma.invoice.findMany({
      where: { organizationId: orgId, status: "paid", paidAt: null },
      include: { lineItems: true },
    });
    for (const invoice of unstamped) {
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAt: invoice.updatedAt,
          paidAmount: calculateInvoiceTotal(invoice),
          // keep updatedAt stable so paidAt stays equal to it
          updatedAt: invoice.updatedAt,
        },
      });
    }

    const paid = await this.prisma.invoice.findMany({
      where: { organizationId: orgId, status: "paid", projectId: { not: null } },
      select: { id: true },
    });
    for (const { id } of paid) {
      try {
        await this.sync.recordInvoicePaid(id);
      } catch (err) {
        this.logger.error(`Failed to record paid invoice ${id} on contacts`, err);
      }
    }
  }
}
