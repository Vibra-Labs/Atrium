import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { InAppNotificationsService } from "../notifications/in-app-notifications.service";

const BATCH_SIZE = 500;

interface StaffMember {
  organizationId: string;
  userId: string;
  role: string;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Notifies the person who set a contact follow-up once it falls due. */
@Injectable()
export class FollowUpTask {
  private readonly logger = new Logger(FollowUpTask.name);

  constructor(
    private prisma: PrismaService,
    private notifications: InAppNotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    try {
      await this.sendDue(new Date());
    } catch (err) {
      this.logger.error("Contact follow-up run failed", err);
    }
  }

  /** Returns how many contacts were notified. */
  async sendDue(now: Date): Promise<number> {
    // Every change to followUpAt also clears followUpNotifiedAt, so "not yet notified" is enough.
    const due = await this.prisma.contact.findMany({
      where: { followUpAt: { lte: now }, followUpNotifiedAt: null },
      orderBy: { followUpAt: "asc" },
      take: BATCH_SIZE,
    });

    const staff = await this.loadStaff([...new Set(due.map((c) => c.organizationId))]);

    let sent = 0;
    for (const contact of due) {
      try {
        const recipients = this.recipients(staff.get(contact.organizationId) ?? [], contact.followUpOwnerId);
        for (const userId of recipients) {
          await this.notifications.create({
            userId,
            organizationId: contact.organizationId,
            type: "contact_follow_up",
            title: `Follow up with ${contact.name}`,
            message: `Follow-up due ${formatDate(contact.followUpAt as Date)}`,
            link: `/dashboard/contacts/${contact.id}`,
          });
        }
        await this.prisma.contact.update({
          where: { id: contact.id },
          data: { followUpNotifiedAt: now },
        });
        if (recipients.length === 0) {
          this.logger.warn(`No one to remind about contact ${contact.id}; skipping`);
          continue;
        }
        sent++;
      } catch (err) {
        this.logger.error(`Follow-up reminder failed for contact ${contact.id}`, err);
      }
    }
    return sent;
  }

  /** Owners and admins of the given workspaces in one query, grouped by workspace. */
  private async loadStaff(orgIds: string[]): Promise<Map<string, StaffMember[]>> {
    const byOrg = new Map<string, StaffMember[]>();
    if (orgIds.length === 0) return byOrg;
    const rows = await this.prisma.member.findMany({
      where: { organizationId: { in: orgIds }, role: { in: ["owner", "admin"] } },
      select: { organizationId: true, userId: true, role: true },
    });
    for (const row of rows) {
      byOrg.set(row.organizationId, [...(byOrg.get(row.organizationId) ?? []), row]);
    }
    return byOrg;
  }

  /** The follow-up owner if still an owner/admin, otherwise every owner of the workspace. */
  private recipients(staff: StaffMember[], ownerId: string | null): string[] {
    if (ownerId && staff.some((m) => m.userId === ownerId)) return [ownerId];
    return staff.filter((m) => m.role === "owner").map((m) => m.userId);
  }
}
