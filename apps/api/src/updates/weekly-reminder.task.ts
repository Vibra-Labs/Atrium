import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { render } from "@react-email/render";
import { WeeklyUpdateReminderEmail } from "@atrium/email";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { WeeklyUpdatesService, type WeeklyUpdateDue } from "./weekly-updates.service";
import { hasReachedLocalTime } from "../common/helpers/local-time";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fridays at 13:00 in each workspace's own timezone (UTC when none is set). */
const FRIDAY = 5;
const SEND_HOUR = 13;

/** Emails owners/admins the client projects that have gone a week without an update. */
@Injectable()
export class WeeklyReminderTask {
  private readonly logger = new Logger(WeeklyReminderTask.name);

  constructor(
    private prisma: PrismaService,
    private weeklyUpdates: WeeklyUpdatesService,
    private mail: MailService,
    private config: ConfigService,
  ) {}

  // Hourly, because every workspace reaches Friday 13:00 at a different UTC hour.
  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    try {
      await this.sendReminders(new Date());
    } catch (err) {
      this.logger.error("Weekly update reminder run failed", err);
    }
  }

  async sendReminders(now: Date): Promise<void> {
    // Not yet emailed this week. Six days rather than seven so a slightly early run still sends.
    const notSentThisWeek = [
      { weeklyReminderSentAt: null },
      { weeklyReminderSentAt: { lt: new Date(now.getTime() - 6 * DAY_MS) } },
    ];
    const members = await this.prisma.member.findMany({
      where: { role: { in: ["owner", "admin"] }, weeklyUpdateReminders: true, OR: notSentThisWeek },
      select: {
        id: true,
        organizationId: true,
        user: { select: { email: true } },
        organization: { select: { name: true, systemSettings: { select: { timezone: true } } } },
      },
    });

    const dueByOrg = new Map<string, WeeklyUpdateDue[]>();
    let sent = 0;

    for (const member of members) {
      if (!hasReachedLocalTime(now, member.organization.systemSettings?.timezone, FRIDAY, SEND_HOUR)) continue;
      let due: WeeklyUpdateDue[] | undefined = dueByOrg.get(member.organizationId);
      if (!due) {
        due = await this.weeklyUpdates.getDue(member.organizationId, now);
        dueByOrg.set(member.organizationId, due);
      }
      if (due.length === 0) continue;

      const { count } = await this.prisma.member.updateMany({
        where: { id: member.id, OR: notSentThisWeek },
        data: { weeklyReminderSentAt: now },
      });
      if (count === 0) continue;

      // On failure the claim is kept: usually mail isn't configured, and retrying
      // every hour for the rest of the day would only repeat the same queries.
      if (await this.send(member.user.email, member.organizationId, member.organization.name, due, now)) {
        sent++;
      } else {
        this.logger.warn(`Weekly update reminder not sent for org ${member.organizationId}; trying again next week`);
      }
    }

    if (sent > 0) this.logger.log(`Sent ${sent} weekly update reminder(s)`);
  }

  private async send(
    email: string,
    organizationId: string,
    organizationName: string,
    due: WeeklyUpdateDue[],
    now: Date,
  ): Promise<boolean> {
    const webUrl: string = this.config.get("WEB_URL", "http://localhost:3000");
    try {
      const html: string = await render(
        WeeklyUpdateReminderEmail({
          organizationName,
          settingsUrl: `${webUrl}/dashboard/settings/account#notifications`,
          projects: due.map((p) => ({
            name: p.projectName,
            lastUpdate: p.lastUpdateAt
              ? `Last update ${Math.floor((now.getTime() - p.lastUpdateAt.getTime()) / DAY_MS)} days ago`
              : "No updates yet",
            draftUrl: `${webUrl}/dashboard/projects/${p.projectId}?tab=updates&compose=weekly`,
          })),
        }),
      );
      const subject: string =
        due.length === 1
          ? "1 client project needs an update this week"
          : `${due.length} client projects need an update this week`;
      // Pass the workspace so self-hosted installs use their own mail settings.
      const result = await this.mail.send(email, subject, html, organizationId);
      return result.sent;
    } catch (err) {
      this.logger.error(`Failed to send weekly update reminder for org ${organizationId}`, err);
      return false;
    }
  }
}
