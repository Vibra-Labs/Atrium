import { describe, expect, it, mock } from "bun:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { IntegrationsService } from "./integrations.service";

type Row = Record<string, unknown>;

function row(overrides: Row = {}): Row {
  return {
    id: "d1", organizationId: "org1", type: "webhook", name: "Zap",
    url: "enc:https://hooks.example.com/secret-path", secret: "enc:whsec_old",
    events: ["invoice.paid"], projectIds: [], enabled: true, disabledReason: null,
    consecutiveFailures: 0, createdById: "u1", createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function build(opts: { existing?: Row | null; projects?: Row[]; delivery?: Row | null } = {}) {
  const prisma = {
    integrationDestination: {
      findMany: mock(async () => [row()]),
      findFirst: mock(async () => (opts.existing === undefined ? row() : opts.existing)),
      create: mock(async (args: { data: Row }) => row(args.data)),
      update: mock(async (args: { data: Row }) => row(args.data)),
      delete: mock(async () => row()),
    },
    integrationDelivery: {
      findMany: mock(async () => []),
      count: mock(async () => 0),
      findFirst: mock(async () => opts.delivery ?? null),
      create: mock(async (args: { data: Row }) => ({ id: "del_new", ...args.data })),
      findUnique: mock(async () => ({ id: "del_new", status: "success" })),
    },
    project: { findMany: mock(async () => opts.projects ?? []) },
  };
  const settings = { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v.replace(/^enc:/, "") };
  const dispatcher = {
    urlPolicy: { allowPrivate: false, allowHttp: false },
    attempt: mock(async () => {}),
    buildPayload: mock(async (input: Row) => ({ ...input, id: "evt_test" })),
    targetFor: (d: Row) => ({ type: d.type, url: settings.decrypt(String(d.url)), secret: null }),
    send: mock(async () => ({ ok: true, statusCode: 200, error: null, retryAfterMs: null })),
  };
  const checkHost = mock(async () => {});
  const service = new IntegrationsService(prisma as never, settings as never, dispatcher as never);
  service.checkHost = checkHost;
  return { prisma, dispatcher, service };
}

describe("IntegrationsService", () => {
  it("lists destinations with masked URLs and no secrets", async () => {
    const { service } = build();
    const [summary] = await service.list("org1");
    expect(summary.urlPreview).toBe("https://hooks.example.com/••••");
    expect(JSON.stringify(summary)).not.toContain("secret-path");
    expect(JSON.stringify(summary)).not.toContain("whsec");
  });

  it("creates a webhook with encrypted URL and returns the signing secret once", async () => {
    const { service, prisma } = build();
    const created = await service.create(
      { type: "webhook", name: "Zap", url: "https://hooks.example.com/x", events: ["invoice.paid"] },
      "org1", "u1",
    );
    const data = prisma.integrationDestination.create.mock.calls[0][0].data;
    expect(data.url).toBe("enc:https://hooks.example.com/x");
    expect(String(data.secret)).toStartWith("enc:whsec_");
    expect(created.secret).toStartWith("whsec_");
    expect(`enc:${created.secret}`).toBe(String(data.secret));
  });

  it("does not create a secret for Slack", async () => {
    const { service, prisma } = build();
    const created = await service.create(
      { type: "slack", name: "#feed", url: "https://hooks.slack.com/services/a", events: [] }, "org1", "u1",
    );
    expect(prisma.integrationDestination.create.mock.calls[0][0].data.secret).toBeNull();
    expect(created.secret).toBeUndefined();
  });

  it("rejects an invalid URL", async () => {
    const { service } = build();
    await expect(
      service.create({ type: "slack", name: "x", url: "https://evil.com/", events: [] }, "org1", "u1"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects project ids from another workspace", async () => {
    const { service } = build({ projects: [{ id: "p1" }] });
    await expect(
      service.create(
        { type: "slack", name: "x", url: "https://hooks.slack.com/services/a", events: [], projectIds: ["p1", "p2"] },
        "org1", "u1",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("re-enabling clears the failure streak and reason", async () => {
    const { service, prisma } = build({ existing: row({ enabled: false, disabledReason: "x", consecutiveFailures: 10 }) });
    await service.update("d1", { enabled: true }, "org1");
    expect(prisma.integrationDestination.update.mock.calls[0][0].data).toMatchObject({
      enabled: true, disabledReason: null, consecutiveFailures: 0,
    });
  });

  it("validates and encrypts a changed URL", async () => {
    const { service, prisma } = build();
    await service.update("d1", { url: "https://hooks.example.com/new" }, "org1");
    expect(prisma.integrationDestination.update.mock.calls[0][0].data.url).toBe("enc:https://hooks.example.com/new");
  });

  it("404s for destinations in another workspace", async () => {
    const { service } = build({ existing: null });
    await expect(service.update("d1", { name: "x" }, "org2")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove("d1", "org2")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rotates the secret for webhooks only", async () => {
    const { service } = build();
    const { secret } = await service.rotateSecret("d1", "org1");
    expect(secret).toStartWith("whsec_");

    const slack = build({ existing: row({ type: "slack", secret: null }) });
    await expect(slack.service.rotateSecret("d1", "org1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("sends a test ping straight away", async () => {
    const { service, dispatcher } = build();
    const result = await service.test("d1", "org1", "u1");
    expect(result).toEqual({ ok: true, statusCode: 200, error: null });
    const payload = (dispatcher.send.mock.calls[0] as unknown as Row[])[1];
    expect(payload.event).toBe("test.ping");
  });

  it("resends a delivery as a new pending delivery", async () => {
    const { service, prisma, dispatcher } = build({
      delivery: { id: "del_1", destinationId: "d1", event: "invoice.paid", payload: { a: 1 } },
    });
    await service.resend("del_1", "org1");
    expect(prisma.integrationDelivery.findFirst.mock.calls[0][0]).toMatchObject({
      where: { id: "del_1", destination: { organizationId: "org1" } },
    });
    expect(prisma.integrationDelivery.create.mock.calls[0][0].data).toMatchObject({
      destinationId: "d1", event: "invoice.paid", payload: { a: 1 }, status: "pending",
    });
    expect(dispatcher.attempt).toHaveBeenCalledWith("del_new");
  });
});
