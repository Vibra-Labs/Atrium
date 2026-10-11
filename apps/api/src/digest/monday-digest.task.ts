import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { render } from "@react-email/render";
import { MondayDigestEmail } from "@atrium/email";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { MondayDigestService, type MondayDigest } from "./monday-digest.service";
import { hasReachedLocalTime } from "../common/helpers/local-time";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Mondays at 08:00 in each workspace's own timezone (UTC when none is set). */
const MONDAY = 1;
const SEND_HOUR = 8;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "Your week: 2 tasks due, 1 update, 1 overdue invoice", leaving out empty parts. */
export function digestSubject(digest: MondayDigest): string {
  const parts: string[] = [];
  if (digest.taskTotal > 0) parts.push(`${plural(digest.taskTotal, "task")} due`);
  if (digest.activityTotal > 0) parts.push(plural(digest.activityTotal, "update"));
  if (digest.overdueInvoices.length > 0) parts.push(plural(digest.overdueInvoices.length, "overdue invoice"));
  return `Your week: ${parts.join(", ")}`;
}

function shortDate(date: Date | null): string {
  return date ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "soon";
}

/** Emails owners/admins what's due this week and what changed since last week. */
@Injectable()
export class MondayDigestTask {
  private readonly logger = new Logger(MondayDigestTask.name);

  constructor(
    private prisma: PrismaService,
    private digests: MondayDigestService,
    private mail: MailService,
    private config: ConfigService,
  ) {}

  // Hourly, because every workspace reaches Monday 08:00 at a different UTC hour.
  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    try {
      await this.sendDigests(new Date());
    } catch (err) {
      this.logger.error("Monday digest run failed", err);
    }
  }

  async sendDigests(now: Date): Promise<void> {
    // Not yet sent this week. Six days rather than seven so a slightly early run still sends.
    const notSentThisWeek = [
      { mondayDigestSentAt: null },
      { mondayDigestSentAt: { lt: new Date(now.getTime() - 6 * DAY_MS) } },
    ];
    const members = await this.prisma.member.findMany({
      where: { role: { in: ["owner", "admin"] }, mondayDigest: true, OR: notSentThisWeek },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        user: { select: { email: true } },
        organization: { select: { name: true, systemSettings: { select: { timezone: true } } } },
      },
    });

    let sent = 0;
    for (const member of members) {
      if (!hasReachedLocalTime(now, member.organization.systemSettings?.timezone, MONDAY, SEND_HOUR)) continue;
      const digest: MondayDigest = await this.digests.collect(
        { userId: member.userId, organizationId: member.organizationId },
        now,
      );
      if (digest.isEmpty) continue;

      const { count } = await this.prisma.member.updateMany({
        where: { id: member.id, OR: notSentThisWeek },
        data: { mondayDigestSentAt: now },
      });
      if (count === 0) continue;

      // On failure the claim is kept: usually mail isn't configured, and retrying
      // every hour for the rest of the day would only repeat the same queries.
      if (await this.send(member.user.email, member.organizationId, member.organization.name, digest)) {
        sent++;
      } else {
        this.logger.warn(`Monday digest not sent for org ${member.organizationId}; trying again next week`);
      }
    }

    if (sent > 0) this.logger.log(`Sent ${sent} Monday digest(s)`);
  }

  private async send(
    email: string,
    organizationId: string,
    organizationName: string,
    digest: MondayDigest,
  ): Promise<boolean> {
    const webUrl: string = this.config.get("WEB_URL", "http://localhost:3000");
    const dashboardUrl = `${webUrl}/dashboard`;
    try {
      const html: string = await render(
        MondayDigestEmail({
          organizationName,
          tasks: digest.tasks.map((t) => ({
            title: t.title,
            projectName: t.projectName,
            due: shortDate(t.dueDate),
            overdue: t.overdue,
          })),
          moreTasks: digest.taskTotal - digest.tasks.length,
          activity: digest.activity.map((a) => ({
            title: a.title,
            message: a.message,
            url: a.link ? `${webUrl}${a.link}` : dashboardUrl,
          })),
          moreActivity: digest.activityTotal - digest.activity.length,
          overdueInvoices: digest.overdueInvoices.map((inv) => ({
            invoiceNumber: inv.invoiceNumber,
            due: shortDate(inv.dueDate),
            url: inv.projectId ? `${webUrl}/dashboard/projects/${inv.projectId}?tab=invoices` : dashboardUrl,
          })),
          dashboardUrl,
          settingsUrl: `${webUrl}/dashboard/settings/account#notifications`,
        }),
      );
      // Pass the workspace so self-hosted installs use their own mail settings.
      const result = await this.mail.send(email, digestSubject(digest), html, organizationId);
      return result.sent;
    } catch (err) {
      this.logger.error(`Failed to send Monday digest for org ${organizationId}`, err);
      return false;
    }
  }
}
