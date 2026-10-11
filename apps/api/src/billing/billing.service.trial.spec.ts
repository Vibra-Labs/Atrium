import { describe, expect, it, mock } from "bun:test";
import { BillingService, isTrialExpired } from "./billing.service";

const FREE = { id: "plan-free", slug: "free" };
const PRO = { id: "plan-pro", slug: "pro" };
const DAY_MS = 24 * 60 * 60 * 1000;

function build(env: Record<string, string> = {}) {
  const values: Record<string, string> = { BILLING_ENABLED: "true", ...env };
  const config = { get: (k: string, fallback?: string) => values[k] ?? fallback };
  const prisma = {
    subscriptionPlan: {
      findUnique: mock(({ where }: { where: { slug: string } }) =>
        Promise.resolve(where.slug === "pro" ? PRO : where.slug === "free" ? FREE : null),
      ),
    },
    subscription: {
      create: mock((args: unknown) => Promise.resolve(args)),
      findUnique: mock((): Promise<unknown> => Promise.resolve(null)),
      updateMany: mock((): Promise<{ count: number }> => Promise.resolve({ count: 1 })),
    },
  };
  // No Stripe key: initializeFreePlan skips customer creation.
  const stripe = { resolveKey: () => null, stripe: {} };
  const service = new BillingService(prisma as never, stripe as never, config as never);
  return { service, prisma };
}

function createdData(prisma: ReturnType<typeof build>["prisma"]): Record<string, unknown> {
  const call = prisma.subscription.create.mock.calls[0] as [{ data: Record<string, unknown> }];
  return call[0].data;
}

describe("trial start", () => {
  it("starts new workspaces on a 14-day Pro trial", async () => {
    const { service, prisma } = build();
    const before = Date.now();
    await service.initializeFreePlan("org1", { trial: true });
    const data = createdData(prisma);
    expect(data.planId).toBe("plan-pro");
    expect(data.status).toBe("trialing");
    const end = (data.currentPeriodEnd as Date).getTime();
    expect(end - before).toBeGreaterThanOrEqual(14 * DAY_MS);
    expect(end - before).toBeLessThan(14 * DAY_MS + 60_000);
  });

  it("honours TRIAL_DAYS", async () => {
    const { service, prisma } = build({ TRIAL_DAYS: "7" });
    await service.initializeFreePlan("org1", { trial: true });
    const end = (createdData(prisma).currentPeriodEnd as Date).getTime();
    expect(Math.round((end - Date.now()) / DAY_MS)).toBe(7);
  });

  it("starts on Free when TRIAL_DAYS is 0", async () => {
    const { service, prisma } = build({ TRIAL_DAYS: "0" });
    await service.initializeFreePlan("org1", { trial: true });
    expect(createdData(prisma)).toMatchObject({ planId: "plan-free", status: "active" });
  });

  it("does not give a trial to existing workspaces initialised lazily", async () => {
    const { service, prisma } = build();
    await service.initializeFreePlan("org1");
    expect(createdData(prisma)).toMatchObject({ planId: "plan-free", status: "active" });
  });
});

describe("trial expiry", () => {
  const past = new Date(Date.now() - 1000);
  const future = new Date(Date.now() + DAY_MS);

  it("isTrialExpired only matches app trials past their end date", () => {
    const now = new Date();
    expect(isTrialExpired({ status: "trialing", currentPeriodEnd: past, stripeSubscriptionId: null }, now)).toBe(true);
    expect(isTrialExpired({ status: "trialing", currentPeriodEnd: future, stripeSubscriptionId: null }, now)).toBe(false);
    expect(isTrialExpired({ status: "active", currentPeriodEnd: past, stripeSubscriptionId: null }, now)).toBe(false);
    // A Stripe-managed trial is Stripe's to end, via webhooks.
    expect(isTrialExpired({ status: "trialing", currentPeriodEnd: past, stripeSubscriptionId: "sub_x" }, now)).toBe(false);
  });

  it("downgrades an expired trial to Free when the subscription is read", async () => {
    const { service, prisma } = build();
    const trialing = { id: "sub1", status: "trialing", currentPeriodEnd: past, stripeSubscriptionId: null, plan: PRO };
    prisma.subscription.findUnique
      .mockResolvedValueOnce(trialing)
      .mockResolvedValueOnce({ ...trialing, status: "active", currentPeriodEnd: null, plan: FREE });
    const sub = await service.getSubscription("org1");
    const call = prisma.subscription.updateMany.mock.calls[0] as unknown as [{ where: Record<string, unknown>; data: Record<string, unknown> }];
    // Only a row that is still a trial is touched, so a paid plan activated meanwhile survives.
    expect(call[0].where).toMatchObject({ id: "sub1", status: "trialing", stripeSubscriptionId: null });
    expect(call[0].data).toMatchObject({ planId: "plan-free", status: "active", currentPeriodEnd: null });
    // Recorded so the trial-ended email goes out even if nobody is using the app.
    expect(call[0].data.trialEndedAt).toBeInstanceOf(Date);
    expect(sub?.plan.slug).toBe("free");
  });

  it("returns whatever the row became when another writer got there first", async () => {
    const { service, prisma } = build();
    const trialing = { id: "sub1", status: "trialing", currentPeriodEnd: past, stripeSubscriptionId: null, plan: PRO };
    prisma.subscription.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.subscription.findUnique
      .mockResolvedValueOnce(trialing)
      .mockResolvedValueOnce({ ...trialing, status: "active", stripeSubscriptionId: "sub_paid", plan: PRO });
    const sub = await service.getSubscription("org1");
    expect(sub?.plan.slug).toBe("pro");
  });

  it("leaves an active trial alone", async () => {
    const { service, prisma } = build();
    prisma.subscription.findUnique.mockResolvedValue({
      id: "sub1", status: "trialing", currentPeriodEnd: future, stripeSubscriptionId: null, plan: PRO,
    });
    const sub = await service.getSubscription("org1");
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    expect(sub?.plan.slug).toBe("pro");
  });
});
