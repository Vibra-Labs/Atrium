import { describe, expect, it, mock, beforeEach } from "bun:test";
import { BillingService } from "./billing.service";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { StripeService } from "./stripe.service";
import type { ConfigService } from "@nestjs/config";

const FREE_PLAN = {
  id: "plan-free",
  name: "Free",
  slug: "free",
  stripePriceId: null,
  priceMonthly: 0,
  priceYearly: 0,
  priceLifetime: 0,
  maxProjects: 2,
  maxStorageMb: 100,
  maxMembers: 1,
  maxClients: 3,
  maxSeats: -1,
  isRecurring: false,
  features: [],
  description: "Free plan",
  sortOrder: 0,
  isActive: true,
};

const PRO_PLAN = {
  id: "plan-pro",
  name: "Pro",
  slug: "pro",
  stripePriceId: "price_pro_123",
  priceMonthly: 2900,
  priceYearly: 29000,
  priceLifetime: 0,
  maxProjects: -1,
  maxStorageMb: 10240,
  maxMembers: 5,
  maxClients: -1,
  maxSeats: -1,
  isRecurring: true,
  features: [],
  description: "Pro plan",
  sortOrder: 1,
  isActive: true,
};

const LIFETIME_PLAN = {
  id: "plan-lifetime",
  name: "Lifetime",
  slug: "lifetime",
  stripePriceId: "price_lifetime_123",
  priceMonthly: 0,
  priceYearly: 0,
  priceLifetime: 49900,
  maxProjects: -1,
  maxStorageMb: 25600,
  maxMembers: 100,
  maxClients: -1,
  maxSeats: 100,
  isRecurring: false,
  features: [],
  description: "Lifetime plan",
  sortOrder: 2,
  isActive: true,
};

const mockPrisma = {
  subscriptionPlan: {
    findMany: mock(() => Promise.resolve([FREE_PLAN, PRO_PLAN, LIFETIME_PLAN])),
    findUnique: mock(() => Promise.resolve(FREE_PLAN)),
  },
  subscription: {
    findUnique: mock(() =>
      Promise.resolve({
        id: "sub-1",
        organizationId: "org-1",
        planId: FREE_PLAN.id,
        stripeCustomerId: "cus_123",
        status: "active",
        plan: FREE_PLAN,
      }),
    ),
    create: mock(() => Promise.resolve({ id: "sub-new" })),
    update: mock(() => Promise.resolve({ id: "sub-1" })),
    count: mock(() => Promise.resolve(0)),
  },
  project: {
    count: mock(() => Promise.resolve(1)),
  },
  file: {
    aggregate: mock(() => Promise.resolve({ _sum: { sizeBytes: 5242880 } })),
  },
  invitation: {
    count: mock((_args?: unknown) => Promise.resolve(0)),
  },
  member: {
    count: mock(() => Promise.resolve(1)),
  },
  organization: {
    findUnique: mock(() => Promise.resolve({ id: "org-1", name: "Test Org" })),
  },
};

const mockStripeService = {
  resolveKey: mock((suffix: string) => suffix === "SECRET_KEY" ? "sk_test_123" : ""),
  stripe: {
    customers: {
      create: mock(() => Promise.resolve({ id: "cus_new" })),
    },
    checkout: {
      sessions: {
        create: mock(() => Promise.resolve({ url: "https://checkout.stripe.com/pay/test" })),
      },
    },
    billingPortal: {
      sessions: {
        create: mock(() => Promise.resolve({ url: "https://billing.stripe.com/session/test" })),
      },
    },
  },
};

const mockConfig = {
  get: mock((key: string, defaultValue?: string) => {
    const values: Record<string, string> = {
      BILLING_ENABLED: "true",
      DEFAULT_PLAN_SLUG: "free",
      STRIPE_SECRET_KEY: "sk_test_123",
    };
    return values[key] ?? defaultValue;
  }),
};

function clearAllMocks() {
  for (const model of Object.values(mockPrisma)) {
    for (const fn of Object.values(model)) {
      if (typeof fn === "function" && "mockClear" in fn) {
        (fn as ReturnType<typeof mock>).mockClear?.();
      }
    }
  }
}

describe("BillingService", () => {
  let service: BillingService;

  beforeEach(() => {
    clearAllMocks();
    service = new BillingService(
      mockPrisma as unknown as PrismaService,
      mockStripeService as unknown as StripeService,
      mockConfig as unknown as ConfigService,
    );
  });

  it("getPlans returns active plans sorted by sortOrder", async () => {
    const plans = await service.getPlans();
    expect(mockPrisma.subscriptionPlan.findMany).toHaveBeenCalled();
    expect(plans).toHaveLength(3);
  });

  it("getSubscription returns subscription with plan", async () => {
    const sub = await service.getSubscription("org-1");
    expect(mockPrisma.subscription.findUnique).toHaveBeenCalled();
    expect(sub?.plan).toBeDefined();
  });

  it("getUsage counts every staff role as a team member, not just admins", async () => {
    await service.getUsage("org-1");
    const calls = mockPrisma.member.count.mock.calls as unknown as [{ where: Record<string, unknown> }][];
    expect(calls.map((c) => c[0].where)).toEqual([
      { organizationId: "org-1", role: { not: "member" } },
      { organizationId: "org-1", role: "member" },
    ]);
    const invites = mockPrisma.invitation.count.mock.calls as unknown as [{ where: Record<string, unknown> }][];
    // A role-less invite is a portal invite (Better Auth's default), so it takes a client seat.
    expect(invites.map((c) => [c[0].where.role, c[0].where.AND])).toEqual([
      [{ not: "member" }, undefined],
      [undefined, [{ OR: [{ role: "member" }, { role: null }] }]],
    ]);
  });

  it("getUsage does not charge a seat for the workspace creator", async () => {
    // Only the owner who created the workspace: no team members used.
    mockPrisma.member.count.mockImplementation(({ where }: { where: { role: unknown } }) =>
      Promise.resolve(where.role === "member" ? 0 : 1),
    );
    expect((await service.getUsage("org-1")).members).toBe(0);
    // The creator plus one invited owner and one admin: two seats used.
    mockPrisma.member.count.mockImplementation(({ where }: { where: { role: unknown } }) =>
      Promise.resolve(where.role === "member" ? 0 : 3),
    );
    expect((await service.getUsage("org-1")).members).toBe(2);
    mockPrisma.member.count.mockImplementation(() => Promise.resolve(1));
  });

  it("getUsage returns counts for all resources", async () => {
    const usage = await service.getUsage("org-1");
    expect(usage.projects).toBe(1);
    expect(usage.storageMb).toBe(5); // 5242880 / 1048576 rounded
    expect(usage.members).toBe(0); // the creator's own owner row is free
    expect(usage.clients).toBe(1);
  });

  it("getUsage counts pending invitations as taken seats", async () => {
    // One pending client invite and one pending admin invite.
    mockPrisma.invitation.count.mockImplementation(() => Promise.resolve(1));
    const usage = await service.getUsage("org-1");
    expect(usage.clients).toBe(2);
    expect(usage.members).toBe(1);
    const call = mockPrisma.invitation.count.mock.calls[0] as unknown as [{ where: Record<string, unknown> }];
    expect(call[0].where).toMatchObject({ organizationId: "org-1", status: "pending" });
    expect(call[0].where.expiresAt).toBeDefined();
    mockPrisma.invitation.count.mockImplementation(() => Promise.resolve(0));
  });

  it("initializeFreePlan creates subscription record", async () => {
    mockPrisma.subscription.findUnique.mockResolvedValueOnce(null);
    await service.initializeFreePlan("org-1");
    expect(mockPrisma.subscription.create).toHaveBeenCalled();
    expect(mockStripeService.stripe.customers.create).toHaveBeenCalled();
  });

  it("initializeFreePlan skips when billing disabled", async () => {
    mockConfig.get.mockImplementation((key: string, defaultValue?: string) => {
      if (key === "BILLING_ENABLED") return "false";
      return defaultValue;
    });
    await service.initializeFreePlan("org-1");
    expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
  });

  it("createCheckoutSession throws for free plan", async () => {
    mockPrisma.subscriptionPlan.findUnique.mockImplementation(() =>
      Promise.resolve(FREE_PLAN),
    );
    await expect(
      service.createCheckoutSession("org-1", "free", "http://ok", "http://cancel"),
    ).rejects.toThrow(BadRequestException);
  });

  it("createCheckoutSession throws when plan not found", async () => {
    mockPrisma.subscriptionPlan.findUnique.mockImplementation(() =>
      Promise.resolve(null),
    );
    await expect(
      service.createCheckoutSession("org-1", "nonexistent", "http://ok", "http://cancel"),
    ).rejects.toThrow(NotFoundException);
  });

  it("createCheckoutSession returns Stripe URL for Pro", async () => {
    mockPrisma.subscriptionPlan.findUnique.mockImplementation(() =>
      Promise.resolve(PRO_PLAN),
    );
    const result = await service.createCheckoutSession(
      "org-1",
      "pro",
      "http://ok",
      "http://cancel",
    );
    expect(result.url).toContain("stripe.com");
  });

  it("createPortalSession returns portal URL", async () => {
    const result = await service.createPortalSession(
      "org-1",
      "http://return",
    );
    expect(result.url).toContain("stripe.com");
  });

  it("getLifetimeSeatsRemaining returns correct count", async () => {
    mockPrisma.subscriptionPlan.findUnique.mockImplementation(() =>
      Promise.resolve(LIFETIME_PLAN),
    );
    mockPrisma.subscription.count.mockImplementation(() => Promise.resolve(10));
    const remaining = await service.getLifetimeSeatsRemaining();
    expect(remaining).toBe(90);
  });

  it("initializeFreePlan does nothing when another request already created the row", async () => {
    mockPrisma.subscription.create.mockClear();
    mockStripeService.stripe.customers.create.mockClear();
    await service.initializeFreePlan("org-1");
    expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    // Checked before talking to Stripe, so the loser does not leave an orphaned customer behind.
    expect(mockStripeService.stripe.customers.create).not.toHaveBeenCalled();
  });

  it("initializeFreePlan tolerates losing the create race to a concurrent request", async () => {
    mockPrisma.subscription.findUnique.mockResolvedValueOnce(null);
    mockPrisma.subscription.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed on the fields: (`organizationId`)"), { code: "P2002" }),
    );
    await expect(service.initializeFreePlan("org-1")).resolves.toBeUndefined();
  });
});
