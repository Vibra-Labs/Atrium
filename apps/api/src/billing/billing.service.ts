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
import type { PlanLimitResource } from "../common/decorators/plan-limit.decorator";
import type Stripe from "stripe";

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
    if (sub) return sub;

    // Lazily initialize for orgs created before billing was added
    await this.initializeFreePlan(orgId);
    return this.prisma.subscription.findUnique({
      where: { organizationId: orgId },
      include: { plan: true },
    });
  }

  async getUsage(orgId: string) {
    const [projectCount, storageBytes, memberCount, clientCount] =
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
        // Team members: admins + members (exclude the owner)
        this.prisma.member.count({
          where: { organizationId: orgId, role: { not: "owner" } },
        }),
        // Clients: org members with the "member" role (not owner/admin)
        this.prisma.member.count({
          where: { organizationId: orgId, role: "member" },
        }),
      ]);

    return {
      projects: projectCount,
      storageMb: Math.round(storageBytes / (1024 * 1024)),
      members: memberCount,
      clients: clientCount,
    };
  }

  /** Same rule PlanGuard enforces on REST routes, for callers that are not HTTP handlers (MCP tools). */
  async assertPlanLimit(orgId: string, resource: PlanLimitResource): Promise<void> {
    if (this.config.get("BILLING_ENABLED", "false") !== "true") return;

    const [subscription, usage] = await Promise.all([
      this.getSubscription(orgId),
      this.getUsage(orgId),
    ]);
    if (!subscription) return;

    const message: string | null = planLimitMessage(subscription.plan, usage, resource);
    if (message) throw new ForbiddenException(message);
  }

  async initializeFreePlan(orgId: string) {
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

    await this.prisma.subscription.create({
      data: {
        organizationId: orgId,
        planId: plan.id,
        stripeCustomerId,
        status: "active",
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
