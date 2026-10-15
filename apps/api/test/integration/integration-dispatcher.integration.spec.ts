/**
 * The unit spec mocks `$queryRaw`, so it cannot show that the retry claim
 * actually selects due rows, skips future and finished ones, and hands each
 * row to only one of several concurrent workers. These run the real SQL.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "bun:test";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { IntegrationDispatcher } from "../../src/integrations/integration-dispatcher.service";
import type { ConfigService } from "@nestjs/config";
import type { SettingsService } from "../../src/settings/settings.service";
import type { BillingService } from "../../src/billing/billing.service";

let prisma: PrismaService;
let destinationId: string;

const config = { get: (_key: string, fallback?: string) => fallback } as unknown as ConfigService;
const settings = { decrypt: (v: string) => v, encrypt: (v: string) => v } as unknown as SettingsService;
const billing = { hasFeature: async () => true } as unknown as BillingService;

function makeDispatcher(attempted: string[]): IntegrationDispatcher {
  const dispatcher = new IntegrationDispatcher(prisma, config, settings, billing);
  dispatcher.attempt = async (id: string): Promise<void> => {
    attempted.push(id);
  };
  return dispatcher;
}

async function delivery(status: string, offsetMs: number, createdAt?: Date): Promise<string> {
  const row = await prisma.integrationDelivery.create({
    data: {
      destinationId,
      event: "invoice.paid",
      payload: {},
      status,
      nextAttemptAt: new Date(Date.now() + offsetMs),
      ...(createdAt && { createdAt }),
    },
  });
  return row.id;
}

beforeAll(async () => {
  assertDisposableDatabase();
  prisma = new PrismaService();
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.integrationDelivery.deleteMany({ where: {} });
  await prisma.integrationDestination.deleteMany({ where: {} });
  await prisma.organization.deleteMany({ where: {} });
  await prisma.organization.create({ data: { id: "org_int", name: "Acme" } });
  const dest = await prisma.integrationDestination.create({
    data: {
      organizationId: "org_int", type: "webhook", name: "Zap", url: "https://example.com",
      events: ["invoice.paid"], createdById: "u1",
    },
  });
  destinationId = dest.id;
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("IntegrationDispatcher.processDue", () => {
  it("claims only pending deliveries that are due, and leases them", async () => {
    const due = await delivery("pending", -1000);
    await delivery("pending", 60_000);
    await delivery("success", -1000);
    await delivery("failed", -1000);

    const attempted: string[] = [];
    await makeDispatcher(attempted).processDue();

    expect(attempted).toEqual([due]);
    const leased = await prisma.integrationDelivery.findUniqueOrThrow({ where: { id: due } });
    expect(leased.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 60_000);
  });

  it("never hands the same delivery to two concurrent workers", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await delivery("pending", -1000));

    const a: string[] = [];
    const b: string[] = [];
    await Promise.all([makeDispatcher(a).processDue(), makeDispatcher(b).processDue()]);

    const all = [...a, ...b];
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(ids.sort());
  });
});

describe("IntegrationDispatcher.pruneOld", () => {
  it("deletes finished deliveries older than 30 days and keeps pending ones", async () => {
    const old = new Date(Date.now() - 31 * 24 * 3_600_000);
    await delivery("success", 0, old);
    const oldPending = await delivery("pending", 0, old);
    const recent = await delivery("failed", 0);

    const count = await makeDispatcher([]).pruneOld();

    expect(count).toBe(1);
    const left = (await prisma.integrationDelivery.findMany({ select: { id: true } })).map((r) => r.id);
    expect(left.sort()).toEqual([oldPending, recent].sort());
  });
});
