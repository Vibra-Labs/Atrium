import { describe, expect, it, mock, beforeEach } from "bun:test";
import { PlanGuard } from "./plan.guard";
import { ForbiddenException } from "@nestjs/common";
import { PLAN_LIMIT_KEY } from "../decorators/plan-limit.decorator";
import { PLAN_FEATURE_KEY } from "../decorators/requires-feature.decorator";

const FREE_PLAN = {
  id: "plan-free",
  name: "Free",
  slug: "free",
  maxProjects: 2,
  maxStorageMb: 100,
  maxMembers: 1,
  maxClients: 3,
};

const PRO_PLAN = {
  id: "plan-pro",
  name: "Pro",
  slug: "pro",
  maxProjects: -1,
  maxStorageMb: 10240,
  maxMembers: 5,
  maxClients: -1,
};

const mockReflector = {
  getAllAndOverride: mock((_key: string): string | undefined => undefined),
};

/** Simulate the decorators on the handler being checked. */
function decorate(meta: { limit?: string; feature?: string }): void {
  mockReflector.getAllAndOverride.mockImplementation((key: string) => {
    if (key === PLAN_LIMIT_KEY) return meta.limit;
    if (key === PLAN_FEATURE_KEY) return meta.feature;
    return undefined;
  });
}

const mockConfig = {
  get: mock((key: string, defaultValue?: string) => {
    if (key === "BILLING_ENABLED") return "true";
    return defaultValue;
  }),
};

const mockBillingService = {
  getSubscription: mock(() =>
    Promise.resolve({ plan: FREE_PLAN }),
  ),
  getUsage: mock(() =>
    Promise.resolve({ projects: 1, storageMb: 50, members: 1, clients: 1 }),
  ),
};

function createMockContext(orgId?: string) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        organization: orgId ? { id: orgId } : undefined,
      }),
    }),
  } as any;
}

describe("PlanGuard", () => {
  let guard: PlanGuard;

  beforeEach(() => {
    mockReflector.getAllAndOverride.mockClear();
    mockBillingService.getSubscription.mockClear();
    mockBillingService.getUsage.mockClear();
    guard = new PlanGuard(
      mockReflector as any,
      mockConfig as any,
      mockBillingService as any,
    );
  });

  it("passes when no @PlanLimit decorator", async () => {
    decorate({});
    const result = await guard.canActivate(createMockContext("org-1"));
    expect(result).toBe(true);
  });

  it("passes when billing is disabled", async () => {
    decorate({ limit: "projects" });
    mockConfig.get.mockImplementation((key: string, defaultValue?: string) => {
      if (key === "BILLING_ENABLED") return "false";
      return defaultValue;
    });
    const result = await guard.canActivate(createMockContext("org-1"));
    expect(result).toBe(true);
    // Restore
    mockConfig.get.mockImplementation((key: string, defaultValue?: string) => {
      if (key === "BILLING_ENABLED") return "true";
      return defaultValue;
    });
  });

  it("passes when no org context", async () => {
    decorate({ limit: "projects" });
    const result = await guard.canActivate(createMockContext(undefined));
    expect(result).toBe(true);
  });

  it("passes when under limit", async () => {
    decorate({ limit: "projects" });
    mockBillingService.getSubscription.mockResolvedValue({ plan: FREE_PLAN });
    mockBillingService.getUsage.mockResolvedValue({
      projects: 1,
      storageMb: 50,
      members: 1,
      clients: 1,
    });
    const result = await guard.canActivate(createMockContext("org-1"));
    expect(result).toBe(true);
  });

  it("throws when at limit", async () => {
    decorate({ limit: "projects" });
    mockBillingService.getSubscription.mockResolvedValue({ plan: FREE_PLAN });
    mockBillingService.getUsage.mockResolvedValue({
      projects: 2,
      storageMb: 50,
      members: 1,
      clients: 1,
    });
    await expect(
      guard.canActivate(createMockContext("org-1")),
    ).rejects.toThrow(ForbiddenException);
  });

  it("passes for unlimited plan", async () => {
    decorate({ limit: "projects" });
    mockBillingService.getSubscription.mockResolvedValue({ plan: PRO_PLAN });
    mockBillingService.getUsage.mockResolvedValue({
      projects: 100,
      storageMb: 5000,
      members: 3,
      clients: 50,
    });
    const result = await guard.canActivate(createMockContext("org-1"));
    expect(result).toBe(true);
  });

  it("passes when no subscription found", async () => {
    decorate({ limit: "projects" });
    mockBillingService.getSubscription.mockResolvedValue(null);
    const result = await guard.canActivate(createMockContext("org-1"));
    expect(result).toBe(true);
  });

  it("blocks a Pro feature on the free plan", async () => {
    decorate({ feature: "e_signatures" });
    mockBillingService.getSubscription.mockResolvedValue({ plan: FREE_PLAN });
    await expect(guard.canActivate(createMockContext("org-1"))).rejects.toThrow(
      "E-signatures are available on paid plans. Please upgrade to continue.",
    );
  });

  it("allows a Pro feature on a paid plan", async () => {
    decorate({ feature: "e_signatures" });
    mockBillingService.getSubscription.mockResolvedValue({ plan: PRO_PLAN });
    expect(await guard.canActivate(createMockContext("org-1"))).toBe(true);
  });

  it("allows Pro features when billing is disabled (self-hosted)", async () => {
    decorate({ feature: "custom_domain" });
    mockConfig.get.mockImplementation((key: string, defaultValue?: string) =>
      key === "BILLING_ENABLED" ? "false" : defaultValue,
    );
    expect(await guard.canActivate(createMockContext("org-1"))).toBe(true);
    mockConfig.get.mockImplementation((key: string, defaultValue?: string) =>
      key === "BILLING_ENABLED" ? "true" : defaultValue,
    );
  });

  it("skips the usage query for feature-only routes", async () => {
    decorate({ feature: "online_payments" });
    mockBillingService.getSubscription.mockResolvedValue({ plan: PRO_PLAN });
    await guard.canActivate(createMockContext("org-1"));
    expect(mockBillingService.getUsage).not.toHaveBeenCalled();
  });
});
