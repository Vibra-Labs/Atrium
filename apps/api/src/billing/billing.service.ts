import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { StripeService } from "./stripe.service";
import { planLimitMessage } from "../common/helpers/plan-limit";
import { planHasFeature } from "../common/helpers/plan-feature";
import { PLAN_FEATURES, type PlanFeature } from "@atrium/shared";
import type { PlanLimitResource } from "../common/decorators/plan-limit.decorator";
import type Stripe from "stripe";
import type { Subscription, SubscriptionPlan } from "@atrium/database";

type SubscriptionWithPlan = Subscription & { plan: SubscriptionPlan };

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_PLAN_SLUG = "pro";

/** An app-managed trial (no Stripe subscription) whose end date has passed. */
export function isTrialExpired(
  sub: { status: string; currentPeriodEnd: Date | null; stripeSubscriptionId: string | null },
  now: Date,
): boolean {
  return (
    sub.status === "trialing" &&
    !sub.stripeSubscriptionId &&
    sub.currentPeriodEnd !== null &&
    sub.currentPeriodEnd <= now
  );
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private stripeService: StripeService,
    private config: ConfigService,
  ) {}

  async getPlans() {
    return this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });
  }

  async getSubscription(orgId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { organizationId: orgId },
      include: { plan: true },
    });
    if (sub) return isTrialExpired(sub, new Date()) ? this.expireTrial(sub) : sub;

    // Lazily initialize for orgs created before billing was added
    await this.initializeFreePlan(orgId);
    return this.prisma.subscription.findUnique({
      where: { organizationId: orgId },
      include: { plan: true },
    });
  }

  async getUsage(orgId: string) {
    // A pending invite reserves a seat, so inviting five clients then having them
    // all accept can't slip past the limit.
    const pendingInvites = (role: string) =>
      this.prisma.invitation.count({
        where: { organizationId: orgId, role, status: "pending", expiresAt: { gt: new Date() } },
      });

    const [projectCount, storageBytes, memberCount, clientCount, pendingTeam, pendingClients] =
      await Promise.all([
        this.prisma.project.count({
          where: { organizationId: orgId, archivedAt: null },
        }),
        this.prisma.file
          .aggregate({
            where: { organizationId: orgId },
            _sum: { sizeBytes: true },
          })
          .then((r) => r._sum.sizeBytes ?? 0),
        // Team members are admins; clients ("member" role) have their own limit below
        this.prisma.member.count({
          where: { organizationId: orgId, role: "admin" },
        }),
        // Clients: org members with the "member" role (not owner/admin)
        this.prisma.member.count({
          where: { organizationId: orgId, role: "member" },
        }),
        pendingInvites("admin"),
        pendingInvites("member"),
      ]);

    return {
      projects: projectCount,
      storageMb: Math.round(storageBytes / (1024 * 1024)),
      members: memberCount + pendingTeam,
      clients: clientCount + pendingClients,
    };
  }

  /**
   * Same rule PlanGuard enforces on REST routes, for callers that are not HTTP handlers
   * (MCP tools, auth hooks). `reserved` is subtracted from usage: when an invitation is
   * being accepted it is still counted as pending, so it must not block itself.
   */
  async assertPlanLimit(orgId: string, resource: PlanLimitResource, reserved = 0): Promise<void> {
    if (this.config.get("BILLING_ENABLED", "false") !== "true") return;

    const [subscription, usage] = await Promise.all([
      this.getSubscription(orgId),
      this.getUsage(orgId),
    ]);
    if (!subscription) return;

    if (reserved > 0) {
      const key = resource === "storage" ? "storageMb" : resource;
      usage[key] = Math.max(0, usage[key] - reserved);
    }
    const message: string | null = planLimitMessage(subscription.plan, usage, resource);
    if (message) throw new ForbiddenException(message);
  }

  /**
   * Pro features the org can use plus its trial end, from one subscription read.
   * Everything is on and there is no trial when billing is disabled (self-hosted).
   */
  async getPlanState(orgId: string): Promise<{ features: Record<PlanFeature, boolean>; trialEndsAt: Date | null }> {
    const billingEnabled: boolean = this.config.get("BILLING_ENABLED", "false") === "true";
    const sub = billingEnabled ? await this.getSubscription(orgId) : null;
    const entries = PLAN_FEATURES.map((feature): [PlanFeature, boolean] => [
      feature,
      !sub || planHasFeature(sub.plan, feature),
    ]);
    return {
      features: Object.fromEntries(entries) as Record<PlanFeature, boolean>,
      trialEndsAt: sub?.status === "trialing" && !sub.stripeSubscriptionId ? sub.currentPeriodEnd : null,
    };
  }

  async getFeatures(orgId: string): Promise<Record<PlanFeature, boolean>> {
    return (await this.getPlanState(orgId)).features;
  }

  async hasFeature(orgId: string, feature: PlanFeature): Promise<boolean> {
    return (await this.getFeatures(orgId))[feature];
  }

  /** Drop an ended trial back to the Free plan. Gates read the subscription, so they lock at once. */
  private async expireTrial(sub: SubscriptionWithPlan): Promise<SubscriptionWithPlan> {
    const freePlan = await this.prisma.subscriptionPlan.findUnique({ where: { slug: "free" } });
    if (!freePlan) {
      this.logger.warn("Free plan not found; cannot end expired trial.");
      return sub;
    }
    // Conditional so a checkout webhook or a parallel request that already moved
    // the org off the trial is never overwritten with Free.
    const { count } = await this.prisma.subscription.updateMany({
      where: { id: sub.id, status: "trialing", stripeSubscriptionId: null, currentPeriodEnd: { lte: new Date() } },
      data: {
        planId: freePlan.id,
        status: "active",
        currentPeriodStart: null,
        currentPeriodEnd: null,
        trialEndedAt: new Date(),
      },
    });
    if (count === 1) this.logger.log(`Trial ended for org ${sub.organizationId}; moved to free plan`);
    const fresh = await this.prisma.subscription.findUnique({ where: { id: sub.id }, include: { plan: true } });
    return fresh ?? sub;
  }

  private trialDays(): number {
    const days: number = parseInt(this.config.get("TRIAL_DAYS", "14"), 10);
    return Number.isFinite(days) && days > 0 ? days : 0;
  }

  /** New workspaces pass `trial: true` and start on Pro for TRIAL_DAYS (default 14). */
  async initializeFreePlan(orgId: string, options: { trial?: boolean } = {}) {
    const billingEnabled = this.config.get("BILLING_ENABLED", "false");
    if (billingEnabled !== "true") return;

    const defaultSlug = this.config.get("DEFAULT_PLAN_SLUG", "free");
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { slug: defaultSlug },
    });
    if (!plan) {
      this.logger.warn(
        `Default plan "${defaultSlug}" not found. Skipping subscription initialization.`,
      );
      return;
    }

    // Create Stripe customer
    let stripeCustomerId: string | null = null;
    const stripeKey = this.stripeService.resolveKey("SECRET_KEY");
    if (stripeKey) {
      try {
        const org = await this.prisma.organization.findUnique({
          where: { id: orgId },
        });
        const customer = await this.stripeService.stripe.customers.create({
          metadata: { organizationId: orgId },
          name: org?.name ?? undefined,
        });
        stripeCustomerId = customer.id;
      } catch (err) {
        this.logger.error("Failed to create Stripe customer", err);
      }
    }

    const trialDays: number = options.trial ? this.trialDays() : 0;
    const trialPlan = trialDays > 0
      ? await this.prisma.subscriptionPlan.findUnique({ where: { slug: TRIAL_PLAN_SLUG } })
      : null;
    const now = new Date();

    // Two requests can lazily initialise the same org at once; the second one loses the race.
    const existing = await this.prisma.subscription.findUnique({ where: { organizationId: orgId } });
    if (existing) return;

    await this.prisma.subscription.create({
      data: {
        organizationId: orgId,
        planId: trialPlan?.id ?? plan.id,
        stripeCustomerId,
        status: trialPlan ? "trialing" : "active",
        ...(trialPlan && {
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + trialDays * DAY_MS),
        }),
      },
    });
  }

  async createCheckoutSession(
    orgId: string,
    planSlug: string,
    successUrl: string,
    cancelUrl: string,
  ) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { slug: planSlug },
    });
    if (!plan) throw new NotFoundException("Plan not found");
    if (plan.slug === "free")
      throw new BadRequestException("Cannot checkout for free plan");

    // Check lifetime seat cap
    if (plan.maxSeats > 0) {
      const currentSeats = await this.prisma.subscription.count({
        where: { plan: { slug: planSlug }, status: "active" },
      });
      if (currentSeats >= plan.maxSeats) {
        throw new BadRequestException("No seats remaining for this plan");
      }
    }

    let subscription = await this.prisma.subscription.findUnique({
      where: { organizationId: orgId },
    });
    if (!subscription) {
      // Lazily initialize for orgs created before billing was added
      await this.initializeFreePlan(orgId);
      subscription = await this.prisma.subscription.findUnique({
        where: { organizationId: orgId },
      });
    }
    if (!subscription)
      throw new NotFoundException("Subscription not found");

    const customerId = await this.ensureStripeCustomer(subscription);
    if (!customerId) throw new BadRequestException("Stripe customer not set up");

    if (!plan.stripePriceId)
      throw new BadRequestException("Plan has no Stripe price configured");

    const isRecurring = plan.isRecurring;
    const session = await this.stripeService.stripe.checkout.sessions.create({
      customer: customerId,
      mode: isRecurring ? "subscription" : "payment",
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        organizationId: orgId,
        planSlug: plan.slug,
      },
    });

    return { url: session.url };
  }

  async createPortalSession(orgId: string, returnUrl: string) {
    let subscription = await this.prisma.subscription.findUnique({
      where: { organizationId: orgId },
    });
    if (!subscription) {
      await this.initializeFreePlan(orgId);
      subscription = await this.prisma.subscription.findUnique({
        where: { organizationId: orgId },
      });
    }
    if (!subscription) {
      throw new BadRequestException("No subscription found");
    }
    const portalCustomerId = await this.ensureStripeCustomer(subscription);
    if (!portalCustomerId) {
      throw new BadRequestException("No Stripe customer found");
    }

    const session =
      await this.stripeService.stripe.billingPortal.sessions.create({
        customer: portalCustomerId,
        return_url: returnUrl,
      });

    return { url: session.url };
  }

  async handleWebhookEvent(event: Stripe.Event) {
    switch (event.type) {
      case "checkout.session.completed":
        await this.handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case "customer.subscription.updated":
        await this.handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;
      case "customer.subscription.deleted":
        await this.handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;
      case "invoice.payment_failed":
        await this.handlePaymentFailed(
          event.data.object as Stripe.Invoice,
        );
        break;
      case "invoice.paid":
        await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      default:
        this.logger.log(`Unhandled webhook event: ${event.type}`);
    }
  }

  async getLifetimeSeatsRemaining() {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { slug: "lifetime" },
    });
    if (!plan || plan.maxSeats < 0) return null;

    const taken = await this.prisma.subscription.count({
      where: { planId: plan.id, status: "active" },
    });
    return Math.max(0, plan.maxSeats - taken);
  }

  // --- Helpers ---

  private async ensureStripeCustomer(
    subscription: { id: string; stripeCustomerId: string | null; organizationId: string },
  ): Promise<string | null> {
    if (subscription.stripeCustomerId) return subscription.stripeCustomerId;

    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: subscription.organizationId },
      });
      const customer = await this.stripeService.stripe.customers.create({
        metadata: { organizationId: subscription.organizationId },
        name: org?.name ?? undefined,
      });

      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { stripeCustomerId: customer.id },
      });

      this.logger.log(
        `Created Stripe customer ${customer.id} for org ${subscription.organizationId}`,
      );
      return customer.id;
    } catch (err) {
      this.logger.error("Failed to create Stripe customer", err);
      return null;
    }
  }

  // --- Webhook handlers ---

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const orgId = session.metadata?.organizationId;
    const planSlug = session.metadata?.planSlug;
    if (!orgId || !planSlug) return;

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { slug: planSlug },
    });
    if (!plan) return;

    const updateData: Record<string, unknown> = {
      planId: plan.id,
      status: "active",
    };

    if (plan.isRecurring && session.subscription) {
      updateData.stripeSubscriptionId = session.subscription as string;
    } else {
      updateData.stripePaymentIntentId = session.payment_intent as string;
      // One-time purchase: clear any trial end date (recurring plans get theirs from Stripe).
      updateData.currentPeriodStart = null;
      updateData.currentPeriodEnd = null;
    }

    await this.prisma.subscription.update({
      where: { organizationId: orgId },
      data: updateData,
    });

    this.logger.log(`Activated ${planSlug} plan for org ${orgId}`);
  }

  private async handleSubscriptionUpdated(sub: Stripe.Subscription) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeCustomerId: sub.customer as string },
    });
    if (!subscription) return;

    // In Stripe API v2026+, period info lives on subscription items
    const firstItem = sub.items?.data?.[0];
    const periodStart = firstItem?.current_period_start;
    const periodEnd = firstItem?.current_period_end;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: sub.status === "active" ? "active" : sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        ...(periodStart && { currentPeriodStart: new Date(periodStart * 1000) }),
        ...(periodEnd && { currentPeriodEnd: new Date(periodEnd * 1000) }),
      },
    });
  }

  private async handleSubscriptionDeleted(sub: Stripe.Subscription) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeCustomerId: sub.customer as string },
    });
    if (!subscription) return;

    // Revert to free plan
    const freePlan = await this.prisma.subscriptionPlan.findUnique({
      where: { slug: "free" },
    });
    if (!freePlan) return;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planId: freePlan.id,
        status: "active",
        stripeSubscriptionId: null,
        cancelAtPeriodEnd: false,
        currentPeriodStart: null,
        currentPeriodEnd: null,
      },
    });

    this.logger.log(`Reverted org ${subscription.organizationId} to free plan`);
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice) {
    if (!invoice.customer) return;
    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeCustomerId: invoice.customer as string },
    });
    if (!subscription) return;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: "past_due" },
    });
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice) {
    if (!invoice.customer) return;
    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeCustomerId: invoice.customer as string },
    });
    if (!subscription) return;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: "active" },
    });
  }
}
