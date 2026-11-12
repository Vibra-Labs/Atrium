import { describe, expect, it } from "bun:test";
import { planPriceLabel, usageOfferText } from "./plan-offers";

const TAIL = " Keep Pro for $29/mo, or get Lifetime while seats last.";
const PRICING = { proMonthlyCents: 2900, lifetimeAvailable: true };

describe("usageOfferText", () => {
  it("names what the workspace has shared", () => {
    expect(usageOfferText({ sharedProjects: 2, clients: 3, updates: 0 }, PRICING)).toBe(
      `You've shared 2 projects with 3 clients.${TAIL}`,
    );
  });

  it("uses the singular for one of each", () => {
    expect(usageOfferText({ sharedProjects: 1, clients: 1, updates: 4 }, PRICING)).toBe(
      `You've shared 1 project with 1 client.${TAIL}`,
    );
  });

  it("falls back to a plain line when nothing is shared yet", () => {
    expect(usageOfferText({ sharedProjects: 0, clients: 2, updates: 5 }, PRICING)).toBe(
      `You've been putting Atrium to work this week.${TAIL}`,
    );
  });
});

describe("usageOfferText pricing", () => {
  it("uses Pro's real price", () => {
    expect(usageOfferText({ sharedProjects: 0, clients: 0, updates: 0 }, { proMonthlyCents: 3900, lifetimeAvailable: true })).toContain(
      "Keep Pro for $39/mo",
    );
  });

  it("doesn't mention Lifetime when it can't be bought", () => {
    expect(usageOfferText({ sharedProjects: 0, clients: 0, updates: 0 }, { proMonthlyCents: 2900, lifetimeAvailable: false })).toBe(
      "You've been putting Atrium to work this week. Keep Pro for $29/mo.",
    );
  });
});

describe("planPriceLabel", () => {
  it("calls a plan with no price Free, even when it's stored as one-time", () => {
    expect(planPriceLabel({ isRecurring: false, priceMonthly: 0, priceLifetime: 0 })).toBe("Free");
  });

  it("shows a monthly price", () => {
    expect(planPriceLabel({ isRecurring: true, priceMonthly: 2900, priceLifetime: 0 })).toBe("$29/mo");
  });

  it("shows a one-time price", () => {
    expect(planPriceLabel({ isRecurring: false, priceMonthly: 0, priceLifetime: 49900 })).toBe("$499 once");
  });
});
