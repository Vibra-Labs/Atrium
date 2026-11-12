import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { BillingService } from "../billing/billing.service";
import { decidePlanOffer, utcDay, type PlanOfferInput, type PlanOfferKind } from "./decide-plan-offer";
import { workspaceActivity, type WorkspaceActivity } from "./workspace-activity";

export type PlanOfferOutcome = "shown" | "dismissed" | "checkout";

export interface DueOffer {
  offer: PlanOfferKind | null;
  /** Only filled for the usage card, which is worded around it. */
  activity: WorkspaceActivity | null;
}

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

  private ensureRow(orgId: string) {
    return this.prisma.planOffer.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId }, update: {} });
  }

  /** Counts today's visit, then says which offer (if any) is due. */
  async due(orgId: string, now: Date = new Date()): Promise<DueOffer> {
    if (!this.billingEnabled()) return { offer: null, activity: null };

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
    if (!org || !sub) return { offer: null, activity: null };

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
    const activity: WorkspaceActivity | null = offer === "usage" ? await workspaceActivity(this.prisma, orgId) : null;
    return { offer, activity };
  }

  /** Marks an offer shown (first write wins) and, for the early offer, how it ended. */
  async record(orgId: string, kind: PlanOfferKind, outcome: PlanOfferOutcome, now: Date = new Date()): Promise<void> {
    if (!this.billingEnabled()) return;
    const field: ShownField = SHOWN_FIELD[kind];
    await this.ensureRow(orgId);
    await this.prisma.planOffer.updateMany({
      where: { organizationId: orgId, [field]: null },
      data: { [field]: now, lastOfferDay: utcDay(now) },
    });
    if (kind === "early" && outcome !== "shown") {
      await this.prisma.planOffer.updateMany({ where: { organizationId: orgId }, data: { earlyOutcome: outcome } });
    }
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
    const data = { earlyShownAt: now, earlyOutcome: "checkout" };
    await this.prisma.planOffer.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...data },
      update: data,
    });
  }
}
