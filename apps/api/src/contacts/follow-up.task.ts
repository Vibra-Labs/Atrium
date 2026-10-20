import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { InAppNotificationsService } from "../notifications/in-app-notifications.service";

const BATCH_SIZE = 500;

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

    let sent = 0;
    for (const contact of due) {
      try {
        const recipients = await this.recipients(contact.organizationId, contact.followUpOwnerId);
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

  /** The follow-up owner if still an owner/admin, otherwise every owner of the workspace. */
  private async recipients(organizationId: string, ownerId: string | null): Promise<string[]> {
    if (ownerId) {
      const current = await this.prisma.member.findMany({
        where: { organizationId, userId: ownerId, role: { in: ["owner", "admin"] } },
        select: { userId: true },
      });
      if (current.length > 0) return [ownerId];
    }
    const owners = await this.prisma.member.findMany({
      where: { organizationId, role: "owner" },
      select: { userId: true },
    });
    return owners.map((m) => m.userId);
  }
}
