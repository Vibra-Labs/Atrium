import { describe, expect, it, mock } from "bun:test";
import { PlanOffersService } from "./plan-offers.service";
import { utcDay } from "./decide-plan-offer";
import type { PrismaService } from "../prisma/prisma.service";
import type { BillingService } from "../billing/billing.service";
import type { ConfigService } from "@nestjs/config";

const DAY_MS: number = 24 * 60 * 60 * 1000;
const NOW: Date = new Date("2026-11-20T15:00:00Z");

interface Row {
  clientInvitedAt: Date | null;
  activeDays: number;
  lastActiveDay: string | null;
  lastOfferDay: string | null;
  earlyShownAt: Date | null;
  earlyOutcome: string | null;
  usageShownAt: Date | null;
  finalShownAt: Date | null;
}

function emptyRow(overrides: Partial<Row> = {}): Row {
  return {
    clientInvitedAt: null,
    activeDays: 1,
    lastActiveDay: null,
    lastOfferDay: null,
    earlyShownAt: null,
    earlyOutcome: null,
    usageShownAt: null,
    finalShownAt: null,
    ...overrides,
  };
}

interface BuildOptions {
  billing?: boolean;
  row?: Row;
  orgCreatedAt?: Date;
  setupCompleted?: boolean;
  subscription?: { status: string; stripeSubscriptionId: string | null; currentPeriodEnd: Date | null; trialEndedAt: Date | null; plan: { slug: string } };
}

function build(options: BuildOptions = {}) {
  const row: Row = options.row ?? emptyRow();
  const prisma = {
    planOffer: {
      upsert: mock(() => Promise.resolve(row)),
      updateMany: mock(() => Promise.resolve({ count: 1 })),
      findUniqueOrThrow: mock(() => Promise.resolve(row)),
    },
    organization: {
      findUnique: mock(() =>
        Promise.resolve({ createdAt: options.orgCreatedAt ?? NOW, setupCompleted: options.setupCompleted ?? true }),
      ),
    },
    project: { count: mock(() => Promise.resolve(2)) },
    member: { count: mock(() => Promise.resolve(3)) },
    projectUpdate: { count: mock(() => Promise.resolve(4)) },
  };
  const billing = {
    getSubscription: mock(() =>
      Promise.resolve(
        options.subscription ?? {
          status: "trialing",
          stripeSubscriptionId: null,
          currentPeriodEnd: new Date(NOW.getTime() + 10 * DAY_MS),
          trialEndedAt: null,
          plan: { slug: "pro" },
        },
      ),
    ),
  };
  const config = { get: (_k: string, fallback?: string) => (options.billing === false ? "false" : "true") ?? fallback };
  const service = new PlanOffersService(
    prisma as unknown as PrismaService,
    billing as unknown as BillingService,
    config as unknown as ConfigService,
  );
  return { service, prisma, billing };
}

describe("PlanOffersService.due", () => {
  it("does nothing at all when billing is off", async () => {
    const { service, prisma, billing } = build({ billing: false, orgCreatedAt: new Date(NOW.getTime() - 5 * DAY_MS) });
    expect(await service.due("org-1", NOW)).toEqual({ offer: null, activity: null });
    expect(prisma.planOffer.upsert).not.toHaveBeenCalled();
    expect(prisma.planOffer.updateMany).not.toHaveBeenCalled();
    expect(billing.getSubscription).not.toHaveBeenCalled();
  });

  it("counts a visit only once per UTC day", async () => {
    const { service, prisma } = build();
    await service.due("org-1", NOW);
    const [args] = prisma.planOffer.updateMany.mock.calls[0] as unknown as [
      { where: { organizationId: string; OR: unknown[] }; data: { activeDays: unknown; lastActiveDay: string } },
    ];
    expect(args.where.organizationId).toBe("org-1");
    expect(args.where.OR).toEqual([{ lastActiveDay: null }, { lastActiveDay: { not: utcDay(NOW) } }]);
    expect(args.data).toEqual({ activeDays: { increment: 1 }, lastActiveDay: utcDay(NOW) });
  });

  it("offers early to a trial owner returning the day after signup", async () => {
    const { service } = build({ orgCreatedAt: new Date(NOW.getTime() - DAY_MS) });
    expect(await service.due("org-1", NOW)).toEqual({ offer: "early", activity: null });
  });

  it("includes the workspace's activity with the usage card", async () => {
    const { service } = build({
      orgCreatedAt: new Date(NOW.getTime() - 4 * DAY_MS),
      row: emptyRow({ earlyShownAt: new Date(NOW.getTime() - 2 * DAY_MS), activeDays: 3 }),
    });
    expect(await service.due("org-1", NOW)).toEqual({
      offer: "usage",
      activity: { sharedProjects: 2, clients: 3, updates: 4 },
    });
  });

  it("offers nothing to a paid workspace", async () => {
    const { service } = build({
      orgCreatedAt: new Date(NOW.getTime() - 4 * DAY_MS),
      subscription: { status: "active", stripeSubscriptionId: "sub_1", currentPeriodEnd: null, trialEndedAt: null, plan: { slug: "pro" } },
    });
    expect((await service.due("org-1", NOW)).offer).toBeNull();
  });

  it("offers the trial-end screen right after a trial drops to Free", async () => {
    const { service } = build({
      orgCreatedAt: new Date(NOW.getTime() - 15 * DAY_MS),
      subscription: { status: "active", stripeSubscriptionId: null, currentPeriodEnd: null, trialEndedAt: new Date(NOW.getTime() - DAY_MS), plan: { slug: "free" } },
    });
    expect((await service.due("org-1", NOW)).offer).toBe("trial_end");
  });
});

describe("PlanOffersService.record", () => {
  it("keeps the first time an offer was shown", async () => {
    const { service, prisma } = build();
    await service.record("org-1", "early", "shown", NOW);
    const [args] = prisma.planOffer.updateMany.mock.calls[0] as unknown as [{ where: Record<string, unknown>; data: Record<string, unknown> }];
    expect(args.where).toEqual({ organizationId: "org-1", earlyShownAt: null });
    expect(args.data).toEqual({ earlyShownAt: NOW, lastOfferDay: utcDay(NOW) });
  });

  it("uses one field for both final screens", async () => {
    const { service, prisma } = build();
    await service.record("org-1", "free", "shown", NOW);
    const [args] = prisma.planOffer.updateMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }];
    expect(args.where).toEqual({ organizationId: "org-1", finalShownAt: null });
  });

  it("stores how the early offer ended", async () => {
    const { service, prisma } = build();
    await service.record("org-1", "early", "checkout", NOW);
    const calls = prisma.planOffer.updateMany.mock.calls as unknown as [{ data: Record<string, unknown> }][];
    expect(calls.some(([a]) => a.data.earlyOutcome === "checkout")).toBe(true);
  });

  it("writes nothing when billing is off", async () => {
    const { service, prisma } = build({ billing: false });
    await service.record("org-1", "early", "shown", NOW);
    expect(prisma.planOffer.updateMany).not.toHaveBeenCalled();
  });
});

describe("PlanOffersService.recordClientInvited", () => {
  it("records a portal invite sent after setup", async () => {
    const { service, prisma } = build();
    await service.recordClientInvited("org-1", "member", NOW);
    const [args] = prisma.planOffer.updateMany.mock.calls[0] as unknown as [{ where: Record<string, unknown>; data: Record<string, unknown> }];
    expect(args.where).toEqual({ organizationId: "org-1", clientInvitedAt: null });
    expect(args.data).toEqual({ clientInvitedAt: NOW });
  });

  it("treats an invite without a role as a portal invite", async () => {
    const { service, prisma } = build();
    await service.recordClientInvited("org-1", null, NOW);
    expect(prisma.planOffer.updateMany).toHaveBeenCalled();
  });

  it("ignores team invites", async () => {
    const { service, prisma } = build();
    await service.recordClientInvited("org-1", "admin", NOW);
    expect(prisma.planOffer.upsert).not.toHaveBeenCalled();
    expect(prisma.planOffer.updateMany).not.toHaveBeenCalled();
  });

  it("ignores invites from the setup wizard", async () => {
    const { service, prisma } = build({ setupCompleted: false });
    await service.recordClientInvited("org-1", "member", NOW);
    expect(prisma.planOffer.updateMany).not.toHaveBeenCalled();
  });

  it("writes nothing when billing is off", async () => {
    const { service, prisma } = build({ billing: false });
    await service.recordClientInvited("org-1", "member", NOW);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.planOffer.updateMany).not.toHaveBeenCalled();
  });
});

describe("PlanOffersService.recordSignupCheckout", () => {
  it("counts a checkout from the pricing page as the early offer", async () => {
    const { service, prisma } = build();
    await service.recordSignupCheckout("org-1", NOW);
    const [args] = prisma.planOffer.upsert.mock.calls[0] as unknown as [{ create: Record<string, unknown>; update: Record<string, unknown> }];
    expect(args.create).toEqual({ organizationId: "org-1", earlyShownAt: NOW, earlyOutcome: "checkout" });
    expect(args.update).toEqual({ earlyShownAt: NOW, earlyOutcome: "checkout" });
  });
});
