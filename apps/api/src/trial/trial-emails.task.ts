import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { TrialEndedEmail, TrialEndingEmail, activitySentence } from "@atrium/email";
import { PrismaService } from "../prisma/prisma.service";
import { BillingService } from "../billing/billing.service";
import { MailService } from "../mail/mail.service";
import { EmailRenderer } from "../mail/email-renderer";
import { DAY_MS } from "../common/helpers/local-time";
import { lifetimeSeatLabel } from "@atrium/shared";
import { workspaceActivity, type WorkspaceActivity } from "../plan-offers/workspace-activity";

const REMINDER_DAYS = 3;

type ClaimField = "trialReminderSentAt" | "trialEndedEmailSentAt";

type EmailSource = "trial_email_ending" | "trial_email_ended";

/** Lifetime's seat state for one run; null when it can't be bought. */
interface LifetimeState {
  maxSeats: number;
  remaining: number | null;
}

interface OfferProps {
  activityLine: string | null;
  proUrl: string;
  lifetimeUrl: string | null;
  lifetimeLabel: string | null;
}

/** Emails workspace owners before and after their app-managed Pro trial ends. */
@Injectable()
export class TrialEmailsTask {
  private readonly logger = new Logger(TrialEmailsTask.name);

  constructor(
    private prisma: PrismaService,
    private billingService: BillingService,
    private mail: MailService,
    private config: ConfigService,
    private renderer: EmailRenderer,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (this.config.get("BILLING_ENABLED", "false") !== "true") return;
    const now: Date = new Date();
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

    const lifetime: LifetimeState | null = due.length > 0 ? await this.lifetimeState() : null;
    for (const sub of due) {
      if (!sub.currentPeriodEnd) continue;
      const daysLeft: number = Math.max(1, Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / DAY_MS));
      const dayWord: string = daysLeft === 1 ? "day" : "days";
      // One workspace failing must not stop the rest from being reminded this hour.
      try {
        const html: string = await this.renderer.render(
          TrialEndingEmail({
            organizationName: sub.organization.name,
            daysLeft,
            endsOn: sub.currentPeriodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }),
            ...(await this.offerProps(sub.organizationId, sub.organization.name, "trial_email_ending", lifetime)),
          }),
        );
        await this.sendOnce(sub, "trialReminderSentAt", now, `Your Atrium Pro trial ends in ${daysLeft} ${dayWord}`, html);
      } catch (err) {
        this.logger.error(`Trial ending reminder failed for org ${sub.organizationId}`, err);
      }
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

    const lifetime: LifetimeState | null = ended.length > 0 ? await this.lifetimeState() : null;
    for (const sub of ended) {
      try {
        // They upgraded before we got to them; mark it handled without emailing.
        if (sub.plan.slug !== "free") {
          await this.claim(sub.id, "trialEndedEmailSentAt", now);
          continue;
        }
        const html: string = await this.renderer.render(
          TrialEndedEmail({
            organizationName: sub.organization.name,
            ...(await this.offerProps(sub.organizationId, sub.organization.name, "trial_email_ended", lifetime)),
          }),
        );
        await this.sendOnce(sub, "trialEndedEmailSentAt", now, "Your Atrium Pro trial has ended", html);
      } catch (err) {
        this.logger.error(`Trial ended notice failed for org ${sub.organizationId}`, err);
      }
    }
  }

  /** Claim the email so other API instances skip it, then send to every owner. */
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

    let delivered: number = 0;
    for (const owner of owners) {
      try {
        // No organizationId: these come from Atrium itself, not the workspace's own mail settings.
        const result: { sent: boolean } = await this.mail.send(owner.user.email, subject, html);
        if (result.sent) delivered++;
      } catch (err) {
        this.logger.error(`Failed to send "${subject}" for org ${sub.organizationId}`, err);
      }
    }

    // The claim is kept on failure: usually mail isn't configured, and retrying every
    // hour forever would only repeat the same work. Owners still see the banner in-app.
    if (delivered === 0) {
      this.logger.error(`"${subject}" not delivered to any owner of org ${sub.organizationId}`);
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

  /** Loaded once per run: the same for every workspace. */
  private async lifetimeState(): Promise<LifetimeState | null> {
    const [plan, remaining] = await Promise.all([
      this.prisma.subscriptionPlan.findUnique({ where: { slug: "lifetime" }, select: { maxSeats: true, isActive: true } }),
      this.billingService.getLifetimeSeatsRemaining(),
    ]);
    if (!plan?.isActive || (remaining !== null && remaining <= 0)) return null;
    return { maxSeats: plan.maxSeats, remaining };
  }

  /** What the workspace did, and links to Pro and (when it can be bought) Lifetime. */
  private async offerProps(
    orgId: string,
    organizationName: string,
    from: EmailSource,
    lifetime: LifetimeState | null,
  ): Promise<OfferProps> {
    const activity: WorkspaceActivity = await workspaceActivity(this.prisma, orgId);
    return {
      activityLine: activitySentence(organizationName, activity),
      proUrl: this.billingUrl("pro", from),
      lifetimeUrl: lifetime ? this.billingUrl("lifetime", from) : null,
      lifetimeLabel:
        lifetime && lifetime.remaining !== null ? lifetimeSeatLabel(lifetime.maxSeats, lifetime.remaining) : null,
    };
  }

  private billingUrl(plan: "pro" | "lifetime", from: EmailSource): string {
    return `${this.config.get("WEB_URL", "http://localhost:3000")}/dashboard/settings/billing?plan=${plan}&from=${from}`;
  }
}
