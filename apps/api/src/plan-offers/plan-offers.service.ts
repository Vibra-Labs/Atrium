import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { BillingService } from "../billing/billing.service";
import { decidePlanOffer, utcDay, type PlanOfferInput, type PlanOfferKind } from "./decide-plan-offer";
import { workspaceActivity, type WorkspaceActivity } from "./workspace-activity";

export type PlanOfferOutcome = "shown" | "dismissed" | "checkout";

export interface OfferPricing {
  proMonthlyCents: number;
  /** False when Lifetime is sold out or switched off. */
  lifetimeAvailable: boolean;
}

export interface DueOffer {
  offer: PlanOfferKind | null;
  /** Only filled for the usage card, which is worded around it. */
  activity: WorkspaceActivity | null;
  /** Only filled for the usage card, which names the price and may offer Lifetime. */
  pricing: OfferPricing | null;
}

const NO_OFFER: DueOffer = { offer: null, activity: null, pricing: null };

type ShownField = "earlyShownAt" | "usageShownAt" | "finalShownAt";

const SHOWN_FIELD: Record<PlanOfferKind, ShownField> = {
  early: "earlyShownAt",
  usage: "usageShownAt",
  trial_end: "finalShownAt",
  free: "finalShownAt",
};

/** When to offer a hosted workspace owner a plan. Self-hosted installs never get here. */
@Injectable()
export class PlanOffersService {
  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
    private config: ConfigService,
  ) {}

  private billingEnabled(): boolean {
    return this.config.get("BILLING_ENABLED", "false") === "true";
  }

  private async ensureRow(orgId: string): Promise<void> {
    await this.prisma.planOffer.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId }, update: {} });
  }

  private async pricing(): Promise<OfferPricing> {
    const [pro, lifetime, seatsRemaining] = await Promise.all([
      this.prisma.subscriptionPlan.findUnique({ where: { slug: "pro" }, select: { priceMonthly: true } }),
      this.prisma.subscriptionPlan.findUnique({ where: { slug: "lifetime" }, select: { isActive: true } }),
      this.billing.getLifetimeSeatsRemaining(),
    ]);
    return {
      proMonthlyCents: pro?.priceMonthly ?? 0,
      lifetimeAvailable: lifetime?.isActive === true && (seatsRemaining === null || seatsRemaining > 0),
    };
  }

  /** Counts today's visit, then says which offer (if any) is due. */
  async due(orgId: string, now: Date = new Date()): Promise<DueOffer> {
    if (!this.billingEnabled()) return NO_OFFER;

    const today: string = utcDay(now);
    await this.ensureRow(orgId);
    // Conditional, so two tabs loading at once count the day once.
    await this.prisma.planOffer.updateMany({
      where: { organizationId: orgId, OR: [{ lastActiveDay: null }, { lastActiveDay: { not: today } }] },
      data: { activeDays: { increment: 1 }, lastActiveDay: today },
    });

    const [state, org, sub] = await Promise.all([
      this.prisma.planOffer.findUniqueOrThrow({ where: { organizationId: orgId } }),
      this.prisma.organization.findUnique({ where: { id: orgId }, select: { createdAt: true } }),
      this.billing.getSubscription(orgId),
    ]);
    if (!org || !sub) return NO_OFFER;

    const trialing: boolean = sub.status === "trialing" && !sub.stripeSubscriptionId;
    const plan: PlanOfferInput["plan"] = trialing ? "trial" : sub.plan.slug === "free" ? "free" : "paid";
    const offer: PlanOfferKind | null = decidePlanOffer({
      now,
      billingEnabled: true,
      signupAt: org.createdAt,
      plan,
      trialEndsAt: trialing ? sub.currentPeriodEnd : null,
      trialEndedAt: sub.trialEndedAt,
      state,
    });
    if (offer !== "usage") return { offer, activity: null, pricing: null };
    const [activity, pricing] = await Promise.all([workspaceActivity(this.prisma, orgId), this.pricing()]);
    return { offer, activity, pricing };
  }

  /**
   * "shown" claims the offer: only the first tab to ask, on a day nothing else was shown,
   * gets `claimed: true`, and only that tab displays it. Other outcomes record how it ended.
   */
  async record(
    orgId: string,
    kind: PlanOfferKind,
    outcome: PlanOfferOutcome,
    now: Date = new Date(),
  ): Promise<{ claimed: boolean }> {
    if (!this.billingEnabled()) return { claimed: false };
    const field: ShownField = SHOWN_FIELD[kind];
    const today: string = utcDay(now);
    await this.ensureRow(orgId);

    if (outcome === "shown") {
      const { count } = await this.prisma.planOffer.updateMany({
        where: { organizationId: orgId, [field]: null, OR: [{ lastOfferDay: null }, { lastOfferDay: { not: today } }] },
        data: { [field]: now, lastOfferDay: today },
      });
      return { claimed: count === 1 };
    }

    // Still mark it shown if the "shown" call never arrived, so it can't come back.
    await this.prisma.planOffer.updateMany({
      where: { organizationId: orgId, [field]: null },
      data: { [field]: now, lastOfferDay: today },
    });
    if (kind === "early") {
      // The first outcome stands: a checkout followed by a dismiss on return stays "checkout".
      await this.prisma.planOffer.updateMany({
        where: { organizationId: orgId, earlyOutcome: null },
        data: { earlyOutcome: outcome },
      });
    }
    return { claimed: false };
  }

  /** A client invite sent from the dashboard. Setup-wizard and team invites don't count. */
  async recordClientInvited(orgId: string, role: string | null, now: Date = new Date()): Promise<void> {
    if (!this.billingEnabled()) return;
    if (role !== null && role !== "member") return;
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { setupCompleted: true } });
    if (!org?.setupCompleted) return;
    await this.ensureRow(orgId);
    await this.prisma.planOffer.updateMany({
      where: { organizationId: orgId, clientInvitedAt: null },
      data: { clientInvitedAt: now },
    });
  }

  /** A signup from the pricing page that went to checkout has already been offered a plan. */
  async recordSignupCheckout(orgId: string, now: Date = new Date()): Promise<void> {
    if (!this.billingEnabled()) return;
    // lastOfferDay too, so someone back from an abandoned checkout isn't asked again today.
    const data: { earlyShownAt: Date; earlyOutcome: string; lastOfferDay: string } = {
      earlyShownAt: now,
      earlyOutcome: "checkout",
      lastOfferDay: utcDay(now),
    };
    await this.prisma.planOffer.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...data },
      update: data,
    });
  }
}
