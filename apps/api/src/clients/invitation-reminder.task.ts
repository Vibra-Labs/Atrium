import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InvitationEmail } from "@atrium/email";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { EmailRenderer } from "../mail/email-renderer";
import { DAY_MS } from "../common/helpers/local-time";
import { formatInvitationExpiry, INVITATION_EXPIRES_IN_SECONDS, REMINDER_AFTER_DAYS } from "./invitations";

/** Re-sends an invitation once, a few days after it was sent, if it is still unanswered. */
@Injectable()
export class InvitationReminderTask {
  private readonly logger = new Logger(InvitationReminderTask.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private config: ConfigService,
    private renderer: EmailRenderer,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    try {
      await this.sendReminders(new Date());
    } catch (err) {
      this.logger.error("Invitation reminder run failed", err);
    }
  }

  async sendReminders(now: Date): Promise<void> {
    const remindAfterMs: number = REMINDER_AFTER_DAYS * DAY_MS;
    const due = await this.prisma.invitation.findMany({
      where: {
        status: "pending",
        reminderSentAt: null,
        // Created at least REMINDER_AFTER_DAYS ago. Older 48-hour invites have all expired by then.
        createdAt: { lte: new Date(now.getTime() - remindAfterMs) },
        // A manual resend pushes expiresAt out to a full term from that moment, so this
        // also waits REMINDER_AFTER_DAYS after the latest send, not just the first.
        expiresAt: { gt: now, lte: new Date(now.getTime() + INVITATION_EXPIRES_IN_SECONDS * 1000 - remindAfterMs) },
      },
      select: {
        id: true,
        email: true,
        organizationId: true,
        inviterId: true,
        expiresAt: true,
        organization: { select: { name: true } },
      },
    });

    const webUrl: string = this.config.get("WEB_URL", "http://localhost:3000");
    for (const inv of due) {
      // One invite failing must not stop the rest from being reminded this hour.
      try {
        // Claim first so other API instances skip it. Kept on failure, like the other
        // scheduled emails: retrying hourly would mostly repeat a mail misconfiguration.
        const { count } = await this.prisma.invitation.updateMany({
          where: { id: inv.id, reminderSentAt: null },
          data: { reminderSentAt: now },
        });
        if (count !== 1) continue;

        // The invite can outlive its purpose, e.g. the person joined through another invite.
        const alreadyMember = await this.prisma.member.findFirst({
          where: { organizationId: inv.organizationId, user: { email: { equals: inv.email, mode: "insensitive" } } },
          select: { id: true },
        });
        if (alreadyMember) continue;

        const inviter = await this.prisma.user.findUnique({ where: { id: inv.inviterId }, select: { name: true } });
        const html: string = await this.renderer.render(
          InvitationEmail({
            inviteUrl: `${webUrl}/accept-invite?id=${inv.id}`,
            organizationName: inv.organization.name,
            inviterName: inviter?.name,
            expiresOn: formatInvitationExpiry(inv.expiresAt),
            reminder: true,
          }),
        );
        await this.mail.send(inv.email, `Reminder: you're invited to ${inv.organization.name}`, html, inv.organizationId);
      } catch (err) {
        this.logger.error(`Invitation reminder failed for invitation ${inv.id}`, err);
      }
    }
  }
}
