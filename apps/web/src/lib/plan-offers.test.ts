import { describe, expect, it } from "bun:test";
import { usageOfferText } from "./plan-offers";

const TAIL = " Keep Pro for $29/mo, or get Lifetime while seats last.";

describe("usageOfferText", () => {
  it("names what the workspace has shared", () => {
    expect(usageOfferText({ sharedProjects: 2, clients: 3, updates: 0 })).toBe(
      `You've shared 2 projects with 3 clients.${TAIL}`,
    );
  });

  it("uses the singular for one of each", () => {
    expect(usageOfferText({ sharedProjects: 1, clients: 1, updates: 4 })).toBe(
      `You've shared 1 project with 1 client.${TAIL}`,
    );
  });

  it("falls back to a plain line when nothing is shared yet", () => {
    expect(usageOfferText({ sharedProjects: 0, clients: 2, updates: 5 })).toBe(
      `You've been putting Atrium to work this week.${TAIL}`,
    );
  });
});
