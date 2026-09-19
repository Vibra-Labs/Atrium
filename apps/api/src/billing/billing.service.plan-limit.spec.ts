import { describe, expect, it, mock } from "bun:test";
import { ForbiddenException } from "@nestjs/common";
import { BillingService } from "./billing.service";

function build(billingEnabled: string, projects: number, maxProjects: number) {
  const config = { get: (_k: string, fallback?: string) => billingEnabled ?? fallback };
  const service = new BillingService({} as never, {} as never, config as never);
  service.getSubscription = mock(() => Promise.resolve({ plan: { name: "Free", maxProjects, maxStorageMb: -1, maxMembers: -1, maxClients: -1 } })) as never;
  service.getUsage = mock(() => Promise.resolve({ projects, storageMb: 0, members: 0, clients: 0 })) as never;
  return service;
}

describe("BillingService.assertPlanLimit", () => {
  it("passes when billing is disabled", async () => {
    await expect(build("false", 99, 1).assertPlanLimit("org1", "projects")).resolves.toBeUndefined();
  });

  it("passes under the limit and for unlimited (-1)", async () => {
    await expect(build("true", 1, 3).assertPlanLimit("org1", "projects")).resolves.toBeUndefined();
    await expect(build("true", 99, -1).assertPlanLimit("org1", "projects")).resolves.toBeUndefined();
  });

  it("throws Forbidden with the upgrade message at the limit", async () => {
    await expect(build("true", 3, 3).assertPlanLimit("org1", "projects")).rejects.toThrow(
      "You've reached the projects limit (3/3) on your Free plan. Please upgrade to continue.",
    );
    await expect(build("true", 3, 3).assertPlanLimit("org1", "projects")).rejects.toBeInstanceOf(ForbiddenException);
  });
});
