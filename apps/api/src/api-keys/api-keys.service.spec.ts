import { describe, expect, it, mock } from "bun:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ApiKeysService, hashApiKey, API_KEY_PREFIX } from "./api-keys.service";

const user = {
  id: "u1", name: "Ada", email: "ada@test.com", emailVerified: true,
  image: null, createdAt: new Date(), updatedAt: new Date(),
};
const organization = {
  id: "org1", name: "Acme", slug: "acme", logo: null,
  createdAt: new Date(), updatedAt: new Date(), metadata: null,
};

function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "k1", name: "Agent", keyHash: "h", keyPrefix: "atr_abcdefgh",
    userId: "u1", organizationId: "org1", memberId: "m1", lastUsedAt: new Date(),
    revokedAt: null, createdAt: new Date(), user, organization,
    ...overrides,
  };
}

function buildPrisma(opts: { key?: unknown; member?: unknown } = {}) {
  return {
    apiKey: {
      create: mock((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "k1", createdAt: new Date(), ...args.data })),
      findUnique: mock(() => Promise.resolve(opts.key ?? null)),
      findFirst: mock(() => Promise.resolve(opts.key ?? null)),
      findMany: mock(() => Promise.resolve([])),
      update: mock(() => Promise.resolve({})),
    },
    member: { findFirst: mock(() => Promise.resolve(opts.member ?? null)) },
  };
}

describe("ApiKeysService", () => {
  it("create returns a prefixed key once and stores only its hash", async () => {
    const prisma = buildPrisma({ member: { id: "m1", role: "admin" } });
    const service = new ApiKeysService(prisma as never);

    const created = await service.create("Agent", "u1", "org1");

    expect(created.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(created.key.length).toBe(4 + 43);
    expect(created.keyPrefix).toBe(created.key.slice(0, 12));
    const data = prisma.apiKey.create.mock.calls[0][0].data;
    expect(data.keyHash).toBe(hashApiKey(created.key));
    expect(JSON.stringify(data)).not.toContain(created.key);
  });

  it("create pins the key to the creator's membership row", async () => {
    const prisma = buildPrisma({ member: { id: "m1", role: "owner" } });
    await new ApiKeysService(prisma as never).create("Agent", "u1", "org1");

    expect(prisma.member.findFirst).toHaveBeenCalledWith({
      where: { userId: "u1", organizationId: "org1" },
    });
    expect(prisma.apiKey.create.mock.calls[0][0].data.memberId).toBe("m1");
  });

  it("create refuses a caller who is not an owner or admin of the workspace", async () => {
    const client = buildPrisma({ member: { id: "m1", role: "member" } });
    await expect(new ApiKeysService(client as never).create("Agent", "u1", "org1"))
      .rejects.toBeInstanceOf(ForbiddenException);

    const stranger = buildPrisma();
    await expect(new ApiKeysService(stranger as never).create("Agent", "u1", "org1"))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(stranger.apiKey.create).not.toHaveBeenCalled();
  });

  it("resolve returns the actor for an owner", async () => {
    const member = { id: "m1", userId: "u1", organizationId: "org1", role: "owner", createdAt: new Date() };
    const service = new ApiKeysService(buildPrisma({ key: keyRow(), member }) as never);

    const actor = await service.resolve("atr_whatever");

    expect(actor?.apiKeyId).toBe("k1");
    expect(actor?.user.id).toBe("u1");
    expect(actor?.organization.id).toBe("org1");
    expect(actor?.member.role).toBe("owner");
  });

  it("resolve checks the membership row the key was issued to, not any row for that user", async () => {
    // A user removed and re-added gets a new member row; the old key must stay dead.
    const member = { id: "m1", userId: "u1", organizationId: "org1", role: "owner", createdAt: new Date() };
    const prisma = buildPrisma({ key: keyRow(), member });
    await new ApiKeysService(prisma as never).resolve("atr_whatever");

    expect(prisma.member.findFirst).toHaveBeenCalledWith({
      where: { id: "m1", userId: "u1", organizationId: "org1" },
    });
  });

  it("resolve returns null for tokens without the prefix, without a lookup", async () => {
    const prisma = buildPrisma({ key: keyRow() });
    const service = new ApiKeysService(prisma as never);

    expect(await service.resolve("not-ours")).toBeNull();
    expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it("resolve returns null for unknown, revoked, or demoted keys", async () => {
    const admin = { id: "m1", userId: "u1", organizationId: "org1", role: "admin", createdAt: new Date() };
    const client = { ...admin, role: "member" };

    expect(await new ApiKeysService(buildPrisma({ member: admin }) as never).resolve("atr_x")).toBeNull();
    expect(await new ApiKeysService(buildPrisma({ key: keyRow({ revokedAt: new Date() }), member: admin }) as never).resolve("atr_x")).toBeNull();
    expect(await new ApiKeysService(buildPrisma({ key: keyRow(), member: client }) as never).resolve("atr_x")).toBeNull();
    expect(await new ApiKeysService(buildPrisma({ key: keyRow() }) as never).resolve("atr_x")).toBeNull();
  });

  it("resolve bumps lastUsedAt only when older than a minute", async () => {
    const member = { id: "m1", userId: "u1", organizationId: "org1", role: "admin", createdAt: new Date() };
    const fresh = buildPrisma({ key: keyRow({ lastUsedAt: new Date() }), member });
    await new ApiKeysService(fresh as never).resolve("atr_x");
    expect(fresh.apiKey.update).not.toHaveBeenCalled();

    const stale = buildPrisma({ key: keyRow({ lastUsedAt: new Date(Date.now() - 120_000) }), member });
    await new ApiKeysService(stale as never).resolve("atr_x");
    expect(stale.apiKey.update).toHaveBeenCalledTimes(1);
  });

  it("revoke throws NotFound for a key in another org", async () => {
    const service = new ApiKeysService(buildPrisma() as never);
    await expect(service.revoke("k1", "org1")).rejects.toBeInstanceOf(NotFoundException);
  });
});
