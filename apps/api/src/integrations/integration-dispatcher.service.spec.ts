import { beforeEach, describe, expect, it, mock } from "bun:test";
import { IntegrationDispatcher } from "./integration-dispatcher.service";
import type { SendResult } from "./delivery-policy";

type Row = Record<string, unknown>;

function destination(overrides: Row = {}): Row {
  return {
    id: "d1", organizationId: "org1", type: "webhook", name: "Zap", url: "enc:https://hooks.example.com/x",
    secret: "enc:whsec", events: ["invoice.paid"], projectIds: [], enabled: true,
    disabledReason: null, consecutiveFailures: 0, ...overrides,
  };
}

function buildDeps(opts: {
  destinations?: Row[]; delivery?: Row | null; hasFeature?: boolean; failures?: number; disableCount?: number;
} = {}) {
  const prisma = {
    integrationDestination: {
      findMany: mock(async () => opts.destinations ?? [destination()]),
      update: mock(async (args: { data: Row }) => ({ ...destination(), ...args.data, consecutiveFailures: opts.failures ?? 1 })),
      updateMany: mock(async () => ({ count: opts.disableCount ?? 1 })),
    },
    integrationDelivery: {
      create: mock(async (args: { data: Row }) => ({ id: `del_${Math.random()}`, ...args.data })),
      findUnique: mock(async () => opts.delivery ?? null),
      update: mock(async () => ({})),
      deleteMany: mock(async () => ({ count: 0 })),
    },
    organization: { findUnique: mock(async () => ({ name: "Acme" })) },
    project: { findUnique: mock(async () => ({ name: "Website" })) },
    user: { findUnique: mock(async () => ({ name: "Jane" })) },
    member: { findMany: mock(async () => [{ userId: "owner1" }]) },
    notification: { createMany: mock(async () => ({ count: 1 })) },
    $transaction: mock(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    $queryRaw: mock(async () => []),
  };
  const config = {
    get: (key: string, fallback?: string) =>
      ({ WEB_URL: "https://app.test/", NODE_ENV: "test" } as Record<string, string>)[key] ?? fallback,
  };
  const settings = {
    encrypt: (v: string) => `enc:${v}`,
    decrypt: (v: string) => v.replace(/^enc:/, ""),
  };
  const billing = { hasFeature: mock(async () => opts.hasFeature ?? true) };
  const send = mock(async (): Promise<SendResult> => ({ ok: true, statusCode: 200, error: null, retryAfterMs: null }));
  const dispatcher = new IntegrationDispatcher(prisma as never, config as never, settings as never, billing as never);
  dispatcher.send = send;
  return { prisma, billing, send, dispatcher };
}

const input = {
  event: "invoice.paid" as const,
  organizationId: "org1",
  projectId: "p1",
  actorId: "u1",
  title: "Invoice INV-1 paid",
  detail: "$100.00",
  data: { invoiceNumber: "INV-1" },
  path: "/dashboard/projects/p1?tab=invoices",
};

describe("IntegrationDispatcher.run", () => {
  it("creates a delivery with the canonical payload and attempts it", async () => {
    const { prisma, send, dispatcher } = buildDeps({
      delivery: { id: "del_1", attempts: 0, status: "pending", payload: {}, destination: destination() },
    });
    await dispatcher.run(input);

    const data = prisma.integrationDelivery.create.mock.calls[0][0].data;
    expect(data.destinationId).toBe("d1");
    expect(data.event).toBe("invoice.paid");
    expect(data.status).toBe("pending");
    const payload = data.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: "invoice.paid",
      workspace: { id: "org1", name: "Acme" },
      project: { id: "p1", name: "Website" },
      actor: { id: "u1", name: "Jane" },
      title: "Invoice INV-1 paid",
      detail: "$100.00",
      url: "https://app.test/dashboard/projects/p1?tab=invoices",
    });
    expect(String(payload.id)).toStartWith("evt_");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("queries only enabled destinations subscribed to the event", async () => {
    const { prisma, dispatcher } = buildDeps({ destinations: [] });
    await dispatcher.run(input);
    expect(prisma.integrationDestination.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: "org1", enabled: true, events: { has: "invoice.paid" } },
    });
    expect(prisma.integrationDelivery.create).not.toHaveBeenCalled();
  });

  it("skips destinations filtered to other projects", async () => {
    const { prisma, dispatcher } = buildDeps({
      destinations: [destination({ id: "d1", projectIds: ["other"] }), destination({ id: "d2", projectIds: ["p1"] })],
    });
    await dispatcher.run(input);
    expect(prisma.integrationDelivery.create).toHaveBeenCalledTimes(1);
    expect(prisma.integrationDelivery.create.mock.calls[0][0].data.destinationId).toBe("d2");
  });

  it("delivers workspace-level events to project-filtered destinations", async () => {
    const { prisma, dispatcher } = buildDeps({ destinations: [destination({ projectIds: ["other"] })] });
    await dispatcher.run({ ...input, event: "payments.stripe_disconnected", projectId: null });
    expect(prisma.integrationDelivery.create).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the plan lacks integrations", async () => {
    const { prisma, dispatcher } = buildDeps({ hasFeature: false });
    await dispatcher.run(input);
    expect(prisma.integrationDelivery.create).not.toHaveBeenCalled();
  });

  it("uses actorName when there is no actor id", async () => {
    const { prisma, dispatcher } = buildDeps();
    await dispatcher.run({ ...input, actorId: null, actorName: "Client Co" });
    const payload = prisma.integrationDelivery.create.mock.calls[0][0].data.payload as Record<string, unknown>;
    expect(payload.actor).toEqual({ id: null, name: "Client Co" });
  });
});

describe("IntegrationDispatcher.attempt", () => {
  let deps: ReturnType<typeof buildDeps>;
  const pending = (overrides: Row = {}): Row => ({
    id: "del_1", attempts: 0, status: "pending", payload: { event: "invoice.paid" },
    destination: destination(), ...overrides,
  });

  beforeEach(() => {
    deps = buildDeps({ delivery: pending() });
  });

  it("decrypts the destination and records success", async () => {
    await deps.dispatcher.attempt("del_1");
    const call = deps.send.mock.calls[0] as unknown as [Row];
    expect(call[0]).toEqual({ type: "webhook", url: "https://hooks.example.com/x", secret: "whsec" });
    const data = deps.prisma.integrationDelivery.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "success", attempts: 1, lastStatusCode: 200, nextAttemptAt: null });
    expect(data.deliveredAt).toBeInstanceOf(Date);
  });

  it("schedules a retry on failure", async () => {
    deps.send.mockImplementation(async () => ({ ok: false, statusCode: 500, error: "down", retryAfterMs: null }));
    const before = Date.now();
    await deps.dispatcher.attempt("del_1");
    const data = deps.prisma.integrationDelivery.update.mock.calls[0][0].data;
    expect(data.status).toBe("pending");
    expect(data.lastError).toBe("down");
    expect((data.nextAttemptAt as Date).getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(deps.prisma.integrationDestination.update).not.toHaveBeenCalled();
  });

  it("counts a final failure against the destination", async () => {
    deps = buildDeps({ delivery: pending({ attempts: 5 }), failures: 3 });
    deps.send.mockImplementation(async () => ({ ok: false, statusCode: 500, error: "down", retryAfterMs: null }));
    await deps.dispatcher.attempt("del_1");
    expect(deps.prisma.integrationDelivery.update.mock.calls[0][0].data.status).toBe("failed");
    expect(deps.prisma.integrationDestination.update.mock.calls[0][0].data).toEqual({
      consecutiveFailures: { increment: 1 },
    });
    expect(deps.prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it("disables the destination and tells admins after 10 final failures", async () => {
    deps = buildDeps({ delivery: pending({ attempts: 5 }), failures: 10 });
    deps.send.mockImplementation(async () => ({ ok: false, statusCode: 500, error: "down", retryAfterMs: null }));
    await deps.dispatcher.attempt("del_1");
    const disable = deps.prisma.integrationDestination.updateMany.mock.calls[0][0];
    expect(disable.where).toEqual({ id: "d1", enabled: true });
    expect(disable.data.enabled).toBe(false);
    expect(disable.data.disabledReason).toContain("10");
    const notes = deps.prisma.notification.createMany.mock.calls[0][0].data as Row[];
    expect(notes[0]).toMatchObject({ userId: "owner1", organizationId: "org1", type: "integration_disabled" });
  });

  it("notifies only once when another failure already disabled the destination", async () => {
    deps = buildDeps({ delivery: pending({ attempts: 5 }), failures: 11, disableCount: 0 });
    deps.send.mockImplementation(async () => ({ ok: false, statusCode: 500, error: "down", retryAfterMs: null }));
    await deps.dispatcher.attempt("del_1");
    expect(deps.prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it("records a failed attempt when the request can't be prepared", async () => {
    deps.send.mockImplementation(async () => { throw new Error("bad decrypt"); });
    await deps.dispatcher.attempt("del_1");
    const data = deps.prisma.integrationDelivery.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "pending", attempts: 1, lastError: "Could not prepare the request" });
  });

  it("resets the failure streak on success", async () => {
    deps = buildDeps({ delivery: pending({ destination: destination({ consecutiveFailures: 4 }) }) });
    await deps.dispatcher.attempt("del_1");
    expect(deps.prisma.integrationDestination.update.mock.calls[0][0].data).toEqual({ consecutiveFailures: 0 });
  });

  it("fails without sending when the destination was disabled", async () => {
    deps = buildDeps({ delivery: pending({ destination: destination({ enabled: false }) }) });
    await deps.dispatcher.attempt("del_1");
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.prisma.integrationDelivery.update.mock.calls[0][0].data.status).toBe("failed");
  });

  it("ignores deliveries that are no longer pending", async () => {
    deps = buildDeps({ delivery: pending({ status: "success" }) });
    await deps.dispatcher.attempt("del_1");
    expect(deps.send).not.toHaveBeenCalled();
  });
});

describe("IntegrationDispatcher.processDue", () => {
  it("attempts every claimed delivery", async () => {
    const { prisma, dispatcher } = buildDeps();
    prisma.$queryRaw.mockImplementation(async () => [{ id: "a" }, { id: "b" }]);
    const attempt = mock(async () => {});
    dispatcher.attempt = attempt;
    await dispatcher.processDue();
    expect(attempt.mock.calls.map((c) => (c as unknown as string[])[0])).toEqual(["a", "b"]);
  });
});

describe("IntegrationDispatcher.urlPolicy", () => {
  function policyFor(env: Record<string, string>) {
    const config = { get: (key: string, fallback?: string) => env[key] ?? fallback };
    return new IntegrationDispatcher({} as never, config as never, {} as never, {} as never).urlPolicy;
  }

  it("refuses http and private addresses in production by default", () => {
    expect(policyFor({ NODE_ENV: "production" })).toEqual({ allowPrivate: false, allowHttp: false });
  });

  it("allows http in production once private URLs are allowed, for LAN services like n8n", () => {
    expect(policyFor({ NODE_ENV: "production", INTEGRATIONS_ALLOW_PRIVATE_URLS: "true" }))
      .toEqual({ allowPrivate: true, allowHttp: true });
  });
});
