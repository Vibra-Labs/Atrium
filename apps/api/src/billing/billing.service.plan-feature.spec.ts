import { describe, expect, it, mock } from "bun:test";
import { BillingService } from "./billing.service";

function build(billingEnabled: string, planSlug: string | null) {
  const config = { get: (_k: string, fallback?: string) => billingEnabled ?? fallback };
  const service = new BillingService({} as never, {} as never, config as never);
  service.getSubscription = mock(() =>
    Promise.resolve(planSlug ? { plan: { slug: planSlug } } : null),
  ) as never;
  return service;
}

describe("BillingService.getFeatures", () => {
  it("grants everything when billing is disabled (self-hosted)", async () => {
    const service = build("false", "free");
    expect(await service.getFeatures("org1")).toEqual({
      custom_domain: true,
      e_signatures: true,
      integrations: true,
      online_payments: true,
      white_label: true,
    });
    expect(service.getSubscription).not.toHaveBeenCalled();
  });

  it("denies Pro features on the free plan", async () => {
    const features = await build("true", "free").getFeatures("org1");
    expect(Object.values(features).every((v) => v === false)).toBe(true);
  });

  it("grants Pro features on a paid plan", async () => {
    const features = await build("true", "pro").getFeatures("org1");
    expect(Object.values(features).every((v) => v === true)).toBe(true);
  });

  it("grants everything when the org has no subscription", async () => {
    const features = await build("true", null).getFeatures("org1");
    expect(features.white_label).toBe(true);
  });
});

describe("BillingService.hasFeature", () => {
  it("reflects the plan", async () => {
    expect(await build("true", "free").hasFeature("org1", "white_label")).toBe(false);
    expect(await build("true", "lifetime").hasFeature("org1", "white_label")).toBe(true);
  });
});
