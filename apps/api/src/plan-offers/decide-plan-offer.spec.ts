import { describe, expect, it } from "bun:test";
import { decidePlanOffer, utcDay, type PlanOfferInput } from "./decide-plan-offer";

const DAY_MS: number = 24 * 60 * 60 * 1000;
const NOW: Date = new Date("2026-11-20T15:00:00Z");
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * DAY_MS);
const daysAhead = (n: number): Date => new Date(NOW.getTime() + n * DAY_MS);

function input(overrides: Partial<PlanOfferInput> = {}, state: Partial<PlanOfferInput["state"]> = {}): PlanOfferInput {
  return {
    now: NOW,
    billingEnabled: true,
    signupAt: NOW,
    plan: "trial",
    trialEndsAt: daysAhead(10),
    trialEndedAt: null,
    ...overrides,
    state: {
      clientInvitedAt: null,
      activeDays: 1,
      lastOfferDay: null,
      earlyShownAt: null,
      usageShownAt: null,
      finalShownAt: null,
      ...state,
    },
  };
}

describe("decidePlanOffer", () => {
  it("never offers anything when billing is off, even with every trigger met", () => {
    const result = decidePlanOffer(
      input({ billingEnabled: false, signupAt: daysAgo(5) }, { clientInvitedAt: daysAgo(1), activeDays: 5 }),
    );
    expect(result).toBeNull();
    expect(decidePlanOffer(input({ billingEnabled: false, plan: "free", trialEndedAt: daysAgo(1) }))).toBeNull();
  });

  it("never offers anything to a paid workspace", () => {
    expect(decidePlanOffer(input({ plan: "paid", signupAt: daysAgo(5) }, { clientInvitedAt: daysAgo(1) }))).toBeNull();
  });

  it("stays quiet on signup day without a client invite", () => {
    expect(decidePlanOffer(input())).toBeNull();
  });

  it("offers early on signup day once a client is invited", () => {
    expect(decidePlanOffer(input({}, { clientInvitedAt: NOW }))).toBe("early");
  });

  it("offers early on a later day than signup", () => {
    expect(decidePlanOffer(input({ signupAt: daysAgo(1) }))).toBe("early");
  });

  it("skips offers 1 and 2 when the trial has 3 days or fewer left", () => {
    expect(decidePlanOffer(input({ signupAt: daysAgo(11), trialEndsAt: daysAhead(3) }))).toBeNull();
    expect(
      decidePlanOffer(
        input({ signupAt: daysAgo(11), trialEndsAt: daysAhead(2) }, { earlyShownAt: daysAgo(5), activeDays: 5 }),
      ),
    ).toBeNull();
  });

  it("waits 2 days after the early offer before the usage card", () => {
    expect(
      decidePlanOffer(input({ signupAt: daysAgo(3) }, { earlyShownAt: daysAgo(1), activeDays: 3 })),
    ).toBeNull();
  });

  it("offers the usage card 2 days after the early offer with 3 days of use", () => {
    expect(
      decidePlanOffer(input({ signupAt: daysAgo(4) }, { earlyShownAt: daysAgo(2), activeDays: 3 })),
    ).toBe("usage");
  });

  it("needs 3 days of use for the usage card", () => {
    expect(
      decidePlanOffer(input({ signupAt: daysAgo(4) }, { earlyShownAt: daysAgo(2), activeDays: 2 })),
    ).toBeNull();
  });

  it("shows the usage card only once", () => {
    expect(
      decidePlanOffer(
        input({ signupAt: daysAgo(6) }, { earlyShownAt: daysAgo(4), usageShownAt: daysAgo(1), activeDays: 5 }),
      ),
    ).toBeNull();
  });

  it("shows the trial-end screen right after a trial ends", () => {
    expect(decidePlanOffer(input({ plan: "free", trialEndsAt: null, trialEndedAt: daysAgo(2) }))).toBe("trial_end");
  });

  it("shows the Free plan screen when the trial ended long ago", () => {
    expect(decidePlanOffer(input({ plan: "free", trialEndsAt: null, trialEndedAt: daysAgo(30) }))).toBe("free");
  });

  it("shows the Free plan screen to a workspace that never had a trial", () => {
    expect(decidePlanOffer(input({ plan: "free", trialEndsAt: null }))).toBe("free");
  });

  it("stops for good once the final screen was shown", () => {
    expect(
      decidePlanOffer(input({ plan: "free", trialEndsAt: null, trialEndedAt: daysAgo(2) }, { finalShownAt: daysAgo(1) })),
    ).toBeNull();
  });

  it("shows at most one offer per day", () => {
    expect(
      decidePlanOffer(
        input({ signupAt: daysAgo(4) }, { earlyShownAt: daysAgo(2), activeDays: 3, lastOfferDay: utcDay(NOW) }),
      ),
    ).toBeNull();
  });
});

describe("utcDay", () => {
  it("formats the UTC calendar day", () => {
    expect(utcDay(new Date("2026-11-20T23:59:00Z"))).toBe("2026-11-20");
  });
});
