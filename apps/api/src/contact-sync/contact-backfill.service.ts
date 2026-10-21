import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import type { Contact } from "@atrium/database";
import { DEFAULT_LEAD_SOURCES } from "@atrium/shared";
import { PrismaService } from "../prisma/prisma.service";
import { calculateInvoiceTotal } from "../payments/invoice-total";
import { ContactSyncService } from "./contact-sync.service";
import { LEGACY_PHONE_LABEL, readPhones, resolvePhones, splitName } from "../contacts/contact-fields";
import type { ContactPhone } from "@atrium/shared";

interface ProfileFill {
  phone?: string | null;
  phones?: ContactPhone[];
  address?: string;
  website?: string;
  description?: string;
  companyId?: string;
  profileImportedAt: Date;
}

/** Turns existing clients, project links, labels and paid invoices into contact data. Idempotent. */
@Injectable()
export class ContactBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ContactBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: ContactSyncService,
  ) {}

  onApplicationBootstrap(): void {
    // Don't hold up boot: the backfill can take a while on large workspaces.
    void this.run().catch((err: unknown) => {
      this.logger.error("Failed to backfill contacts", err);
    });
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
    // Only workspaces that predate lead sources; deleted or renamed defaults stay that way.
    if ((await this.prisma.leadSource.count({ where: { organizationId: orgId } })) === 0) {
      await this.prisma.leadSource.createMany({
        data: DEFAULT_LEAD_SOURCES.map((name) => ({ organizationId: orgId, name })),
        skipDuplicates: true,
      });
    }

    await this.backfillMembers(orgId);
    await this.backfillInvitees(orgId);
    await this.backfillDescriptions(orgId);
    await this.backfillProjectLinks(orgId);
    await this.backfillLabels(orgId);
    await this.backfillPaidInvoices(orgId);
    await this.backfillContactFields(orgId);
  }

  /**
   * Splits names into first/last and seeds phones from the legacy phone column. Idempotent:
   * only contacts with no first name / no phones are touched. updatedAt is kept as it was.
   */
  async backfillContactFields(orgId: string): Promise<void> {
    const unsplit = await this.prisma.contact.findMany({
      where: { organizationId: orgId, firstName: null },
      select: { id: true, name: true, email: true, updatedAt: true },
    });
    for (const contact of unsplit) {
      // A contact made from an invitation is named after the email until the person joins.
      if (contact.email && contact.name === contact.email) continue;
      const names = splitName(contact.name);
      if (!names.firstName) continue;
      try {
        await this.prisma.contact.update({
          where: { id: contact.id },
          data: { ...names, updatedAt: contact.updatedAt },
        });
      } catch (err) {
        this.logger.error(`Failed to split the name of contact ${contact.id}`, err);
      }
    }

    const phoneOnly = await this.prisma.contact.findMany({
      where: { organizationId: orgId, phone: { not: null }, NOT: { phone: "" }, phones: { equals: [] } },
      select: { id: true, phone: true, updatedAt: true },
    });
    for (const contact of phoneOnly) {
      const number = contact.phone?.trim();
      if (!number) continue;
      try {
        await this.prisma.contact.update({
          where: { id: contact.id },
          data: { phones: [{ label: LEGACY_PHONE_LABEL, number }], updatedAt: contact.updatedAt },
        });
      } catch (err) {
        this.logger.error(`Failed to copy the phone of contact ${contact.id}`, err);
      }
    }
  }

  /**
   * Once per workspace: gives each open (pending, unexpired) portal invitation sent before
   * invitations created contacts a contact. Later invitations get one when they are sent, so a
   * second pass would only bring back contacts the owner deleted or re-addressed. The marker is
   * set only when every invitation succeeded, so a failure is retried on the next boot.
   */
  async backfillInvitees(orgId: string, now: Date = new Date()): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { inviteesBackfilledAt: true },
    });
    if (!org || org.inviteesBackfilledAt) return;
    const invitations = await this.prisma.invitation.findMany({
      where: { organizationId: orgId, role: "member", status: "pending", expiresAt: { gt: now } },
      select: { id: true, email: true },
    });
    let failed: boolean = false;
    for (const invitation of invitations) {
      try {
        await this.sync.ensureForInvitee(orgId, invitation.email);
      } catch (err) {
        failed = true;
        this.logger.error(`Failed to backfill contact for invitation ${invitation.id}`, err);
      }
    }
    if (failed) return;
    await this.prisma.organization.update({ where: { id: orgId }, data: { inviteesBackfilledAt: now } });
  }

  /**
   * One-time copy of the old client profile's description into Contact.description for contacts
   * imported before that column existed. Only-if-null: clearing it stores "", so it never returns.
   */
  async backfillDescriptions(orgId: string): Promise<void> {
    const profiles = await this.prisma.clientProfile.findMany({
      where: { organizationId: orgId, description: { not: null } },
      select: { userId: true, description: true },
    });
    const byUser = new Map(
      profiles.flatMap((p) => {
        const text = p.description?.trim();
        return text ? [[p.userId, text] as const] : [];
      }),
    );
    if (byUser.size === 0) return;
    const contacts = await this.prisma.contact.findMany({
      where: {
        organizationId: orgId,
        userId: { in: [...byUser.keys()] },
        profileImportedAt: { not: null },
        description: null,
      },
      select: { id: true, userId: true, updatedAt: true },
    });
    for (const contact of contacts) {
      const description = contact.userId ? byUser.get(contact.userId) : undefined;
      if (!description) continue;
      try {
        await this.prisma.contact.update({
          where: { id: contact.id },
          data: { description, updatedAt: contact.updatedAt },
        });
      } catch (err) {
        this.logger.error(`Failed to copy the description of contact ${contact.id}`, err);
      }
    }
  }

  private async backfillMembers(orgId: string): Promise<void> {
    const members = await this.prisma.member.findMany({
      where: { organizationId: orgId, role: "member" },
      select: { id: true, userId: true },
    });
    for (const member of members) {
      try {
        const contact = await this.sync.ensureForMember(orgId, member.userId);
        if (contact?.userId !== member.userId) continue;
        await this.copyProfile(orgId, member.userId, contact);
      } catch (err) {
        this.logger.error(`Failed to backfill contact for member ${member.id}`, err);
      }
    }
  }

  /**
   * One-time and atomic: runs only while profileImportedAt is null, and all writes (including
   * setting profileImportedAt) commit together, so a failure is retried on the next boot while a
   * success is never repeated (values a user later clears stay cleared).
   */
  private async copyProfile(orgId: string, userId: string, contact: Contact): Promise<void> {
    if (contact.profileImportedAt) return;
    const profile = await this.prisma.clientProfile.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
    });
    if (!profile) return;

    await this.prisma.$transaction(async (tx) => {
      const data: ProfileFill = { profileImportedAt: new Date() };
      // Phones and their phone mirror are written together, so this needs no later backfill step.
      if (contact.phone == null && profile.phone?.trim()) {
        Object.assign(data, resolvePhones({ phone: profile.phone }, readPhones(contact.phones)));
      }
      if (contact.address == null && profile.address) data.address = profile.address;
      if (contact.website == null && profile.website) data.website = profile.website;
      const about = profile.description?.trim();
      if (contact.description == null && about) data.description = about;
      const companyName = profile.company?.trim();
      if (contact.companyId == null && companyName) {
        const existing = await tx.company.findFirst({
          where: { organizationId: orgId, name: { equals: companyName, mode: "insensitive" } },
        });
        const company =
          existing ?? (await tx.company.create({ data: { organizationId: orgId, name: companyName } }));
        data.companyId = company.id;
      }
      // The description goes to About only; notes copied by earlier versions are left as they are.
      await tx.contact.update({ where: { id: contact.id }, data });
    });
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

  /**
   * Moves client (role "member") tags onto their contacts once: the copied MemberLabel rows are
   * deleted in the same transaction, so a tag later removed from the contact isn't copied back on
   * the next boot. Staff tags stay in MemberLabel, which is where they live.
   */
  private async backfillLabels(orgId: string): Promise<void> {
    const memberLabels = await this.prisma.memberLabel.findMany({
      where: { member: { organizationId: orgId, role: "member" } },
      select: { id: true, labelId: true, member: { select: { userId: true } } },
    });
    if (memberLabels.length === 0) return;
    const contacts = await this.prisma.contact.findMany({
      where: { organizationId: orgId, userId: { in: memberLabels.map((m) => m.member.userId) } },
      select: { id: true, userId: true },
    });
    const byUser = new Map(contacts.map((c) => [c.userId, c.id]));
    const copied = memberLabels.filter((m) => byUser.has(m.member.userId));
    if (copied.length === 0) return;
    const data = copied.map((m) => ({ contactId: byUser.get(m.member.userId) as string, labelId: m.labelId }));
    await this.prisma.$transaction([
      this.prisma.contactLabel.createMany({ data, skipDuplicates: true }),
      this.prisma.memberLabel.deleteMany({ where: { id: { in: copied.map((m) => m.id) } } }),
    ]);
  }

  private async backfillPaidInvoices(orgId: string): Promise<void> {
    const unstamped = await this.prisma.invoice.findMany({
      where: { organizationId: orgId, status: "paid", paidAt: null },
      include: { lineItems: true },
    });
    for (const invoice of unstamped) {
      try {
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            paidAt: invoice.updatedAt,
            paidAmount: calculateInvoiceTotal(invoice),
            // keep updatedAt stable so paidAt stays equal to it
            updatedAt: invoice.updatedAt,
          },
        });
      } catch (err) {
        this.logger.error(`Failed to stamp paidAt on invoice ${invoice.id}`, err);
      }
    }

    const recorded = await this.prisma.contactEvent.findMany({
      where: { organizationId: orgId, type: "invoice_paid", refId: { not: null } },
      select: { refId: true },
    });
    const done = new Set(recorded.map((e) => e.refId));
    const pending = await this.prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        status: "paid",
        projectId: { not: null },
        project: { contacts: { some: {} } },
      },
      select: { id: true },
    });
    for (const { id } of pending) {
      if (done.has(id)) continue;
      try {
        await this.sync.recordInvoicePaid(id);
      } catch (err) {
        this.logger.error(`Failed to record paid invoice ${id} on contacts`, err);
      }
    }
  }
}
