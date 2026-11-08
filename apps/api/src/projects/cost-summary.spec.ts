import { describe, expect, it } from "bun:test";
import { costSummary } from "@atrium/shared";
import type { CostInput } from "@atrium/shared";

const base: CostInput = { valueCents: 2500000, costCents: null, laborRateCents: null, trackedSeconds: 0, lineCents: [] };

describe("costSummary", () => {
  it("uses the typed cost when no details are used", () => {
    expect(costSummary({ ...base, costCents: 1700000 })).toEqual({
      detailed: false,
      laborCents: 0,
      costCents: 1700000,
      profitCents: 800000,
      marginPct: 32,
    });
  });

  it("adds labor from tracked time and the cost lines once details are used", () => {
    const s = costSummary({ ...base, costCents: 999, laborRateCents: 4500, trackedSeconds: 153000, lineCents: [500000] });
    expect(s.detailed).toBe(true);
    expect(s.laborCents).toBe(191250);
    expect(s.costCents).toBe(691250);
    expect(s.profitCents).toBe(2500000 - 691250);
  });

  it("is detailed with a rate but no hours yet", () => {
    expect(costSummary({ ...base, laborRateCents: 4500 })).toMatchObject({ detailed: true, laborCents: 0, costCents: 0 });
  });

  it("shows a loss when cost is over value", () => {
    expect(costSummary({ ...base, valueCents: 100000, costCents: 150000 })).toMatchObject({
      profitCents: -50000,
      marginPct: -50,
    });
  });

  it("has no profit or margin without a value", () => {
    expect(costSummary({ ...base, valueCents: null, costCents: 1000 })).toMatchObject({ profitCents: null, marginPct: null });
    expect(costSummary({ ...base, valueCents: 0, costCents: 1000 })).toMatchObject({ profitCents: null, marginPct: null });
  });

  it("has no profit or margin without a cost", () => {
    expect(costSummary(base)).toMatchObject({ costCents: null, profitCents: null, marginPct: null });
  });
});
