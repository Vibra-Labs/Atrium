import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { render } from "@react-email/render";
import { TrialEndedEmail, TrialEndingEmail } from "@atrium/email";
import { PrismaService } from "../prisma/prisma.service";
import { BillingService } from "../billing/billing.service";
import { MailService } from "../mail/mail.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAYS = 3;

type ClaimField = "trialReminderSentAt" | "trialEndedEmailSentAt";

/** Emails workspace owners before and after their app-managed Pro trial ends. */
@Injectable()
export class TrialEmailsTask {
  private readonly logger = new Logger(TrialEmailsTask.name);

  constructor(
    private prisma: PrismaService,
    private billingService: BillingService,
    private mail: MailService,
    private config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (this.config.get("BILLING_ENABLED", "false") !== "true") return;
    const now = new Date();
    try {
      await this.sendEndingReminders(now);
      await this.sendEndedNotices(now);
    } catch (err) {
      this.logger.error("Trial email run failed", err);
    }
  }

  async sendEndingReminders(now: Date): Promise<void> {
    const due = await this.prisma.subscription.findMany({
      where: {
        status: "trialing",
        stripeSubscriptionId: null,
        trialReminderSentAt: null,
        currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + REMINDER_DAYS * DAY_MS) },
      },
      include: { organization: { select: { name: true } } },
    });

    for (const sub of due) {
      if (!sub.currentPeriodEnd) continue;
      const daysLeft: number = Math.max(1, Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / DAY_MS));
      const html: string = await render(
        TrialEndingEmail({
          organizationName: sub.organization.name,
          daysLeft,
          endsOn: sub.currentPeriodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }),
          billingUrl: this.billingUrl(),
        }),
      );
      const dayWord: string = daysLeft === 1 ? "day" : "days";
      await this.sendOnce(sub, "trialReminderSentAt", now, `Your Atrium Pro trial ends in ${daysLeft} ${dayWord}`, html);
    }
  }

  async sendEndedNotices(now: Date): Promise<void> {
    // Trials that ended while nobody was using the app are still marked trialing.
    // Reading the subscription downgrades them and records trialEndedAt.
    const stale = await this.prisma.subscription.findMany({
      where: { status: "trialing", stripeSubscriptionId: null, currentPeriodEnd: { lte: now } },
      select: { organizationId: true },
    });
    for (const { organizationId } of stale) {
      await this.billingService.getSubscription(organizationId);
    }

    const ended = await this.prisma.subscription.findMany({
      where: { trialEndedAt: { not: null }, trialEndedEmailSentAt: null },
      include: { organization: { select: { name: true } }, plan: { select: { slug: true } } },
    });

    for (const sub of ended) {
      // They upgraded before we got to them; mark it handled without emailing.
      if (sub.plan.slug !== "free") {
        await this.claim(sub.id, "trialEndedEmailSentAt", now);
        continue;
      }
      const html: string = await render(
        TrialEndedEmail({ organizationName: sub.organization.name, billingUrl: this.billingUrl() }),
      );
      await this.sendOnce(sub, "trialEndedEmailSentAt", now, "Your Atrium Pro trial has ended", html);
    }
  }

  /** Claim the email so other API instances skip it, send to owners, and release the claim if nothing went out. */
  private async sendOnce(
    sub: { id: string; organizationId: string },
    field: ClaimField,
    now: Date,
    subject: string,
    html: string,
  ): Promise<void> {
    if (!(await this.claim(sub.id, field, now))) return;

    const owners = await this.prisma.member.findMany({
      where: { organizationId: sub.organizationId, role: "owner" },
      select: { user: { select: { email: true } } },
    });

    let delivered = 0;
    for (const owner of owners) {
      try {
        // No organizationId: these come from Atrium itself, not the workspace's own mail settings.
        const result = await this.mail.send(owner.user.email, subject, html);
        if (result.sent) delivered++;
      } catch (err) {
        this.logger.error(`Failed to send "${subject}" for org ${sub.organizationId}`, err);
      }
    }

    if (delivered === 0) {
      await this.prisma.subscription.update({ where: { id: sub.id }, data: { [field]: null } });
      return;
    }
    this.logger.log(`Sent "${subject}" to ${delivered} owner(s) of org ${sub.organizationId}`);
  }

  private async claim(id: string, field: ClaimField, now: Date): Promise<boolean> {
    const { count } = await this.prisma.subscription.updateMany({
      where: { id, [field]: null },
      data: { [field]: now },
    });
    return count === 1;
  }

  private billingUrl(): string {
    return `${this.config.get("WEB_URL", "http://localhost:3000")}/dashboard/settings/billing`;
  }
}
