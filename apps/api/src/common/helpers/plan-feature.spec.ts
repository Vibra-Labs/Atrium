import { describe, expect, it } from "bun:test";
import { planFeatureMessage, planHasFeature } from "./plan-feature";

describe("planHasFeature", () => {
  it("denies Pro features on the free plan", () => {
    expect(planHasFeature({ slug: "free" }, "custom_domain")).toBe(false);
    expect(planHasFeature({ slug: "free" }, "e_signatures")).toBe(false);
    expect(planHasFeature({ slug: "free" }, "online_payments")).toBe(false);
    expect(planHasFeature({ slug: "free" }, "white_label")).toBe(false);
  });

  it("allows every feature on paid plans", () => {
    expect(planHasFeature({ slug: "pro" }, "e_signatures")).toBe(true);
    expect(planHasFeature({ slug: "lifetime" }, "white_label")).toBe(true);
  });
});

describe("planFeatureMessage", () => {
  it("names the feature and asks the user to upgrade", () => {
    expect(planFeatureMessage("e_signatures")).toBe(
      "E-signatures are available on paid plans. Please upgrade to continue.",
    );
  });
});
