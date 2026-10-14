import { afterEach, describe, expect, it, mock } from "bun:test";
import { getPlanSnapshot, loadPlanState, resetPlanState, subscribePlanState, trialDaysLeft } from "./plan-features";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetPlanState();
});

function deferredFetch(): { resolve: (call: number, body: unknown) => void; calls: number } {
  const resolvers: ((body: unknown) => void)[] = [];
  globalThis.fetch = mock(
    () =>
      new Promise<Response>((res) => {
        resolvers.push((body: unknown): void => res(new Response(JSON.stringify(body), { status: 200 })));
      }),
  ) as unknown as typeof fetch;
  return {
    resolve: (call: number, body: unknown): void => resolvers[call](body),
    get calls(): number {
      return resolvers.length;
    },
  };
}

const PRO = { features: { custom_domain: true }, trialEndsAt: "2026-10-22T00:00:00.000Z" };
const FREE = { features: { custom_domain: false }, trialEndsAt: null };

describe("plan state store", () => {
  it("shares one request between components that load at the same time", async () => {
    const f = deferredFetch();
    const a = loadPlanState();
    const b = loadPlanState();
    f.resolve(0, PRO);
    expect(await a).toEqual(await b);
    expect(f.calls).toBe(1);
    expect(getPlanSnapshot()).toEqual(PRO);
  });

  it("tells subscribers when the plan arrives and when it is reset", async () => {
    const f = deferredFetch();
    const seen: unknown[] = [];
    const unsubscribe = subscribePlanState(() => seen.push(getPlanSnapshot()));
    const load = loadPlanState();
    f.resolve(0, PRO);
    await load;
    resetPlanState();
    unsubscribe();
    expect(seen).toEqual([PRO, null]);
  });

  it("discards a response that was in flight for the previous workspace", async () => {
    const f = deferredFetch();
    const stale = loadPlanState();
    resetPlanState(); // switched workspace while the first request was still out
    const fresh = loadPlanState();
    expect(f.calls).toBe(2);

    f.resolve(0, PRO);
    await stale;
    expect(getPlanSnapshot()).toBeNull();

    f.resolve(1, FREE);
    expect(await fresh).toEqual(FREE);
    expect(getPlanSnapshot()).toEqual(FREE);
  });
});

describe("trialDaysLeft", () => {
  const now = new Date("2026-10-08T12:00:00Z");

  it("rounds partial days up", () => {
    expect(trialDaysLeft(new Date("2026-10-22T12:00:00Z"), now)).toBe(14);
    expect(trialDaysLeft(new Date("2026-10-08T13:00:00Z"), now)).toBe(1);
  });

  it("never goes negative", () => {
    expect(trialDaysLeft(new Date("2026-10-01T00:00:00Z"), now)).toBe(0);
  });
});
