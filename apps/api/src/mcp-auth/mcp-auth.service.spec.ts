import { describe, expect, it, mock } from "bun:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { McpAuthService } from "./mcp-auth.service";

const future = new Date(Date.now() + 60_000);
const past = new Date(Date.now() - 60_000);
const user = { id: "u1", name: "Ada" };
const organization = { id: "org1", name: "Acme" };

function build(
  opts: {
    token?: unknown;
    grant?: unknown;
    member?: unknown;
    app?: unknown;
    members?: unknown[];
    grants?: unknown[];
    apps?: unknown[];
  } = {},
) {
  const prisma = {
    oauthAccessToken: {
      findUnique: mock(() => Promise.resolve(opts.token ?? null)),
      deleteMany: mock(() => Promise.resolve({ count: 1 })),
    },
    oauthConsent: { deleteMany: mock(() => Promise.resolve({ count: 1 })) },
    oauthApplication: {
      findUnique: mock(() => Promise.resolve(opts.app ?? null)),
      findMany: mock(() => Promise.resolve(opts.apps ?? [])),
    },
    mcpGrant: {
      findUnique: mock(() => Promise.resolve(opts.grant ?? null)),
      findFirst: mock(() => Promise.resolve(opts.grant ?? null)),
      findMany: mock(() => Promise.resolve(opts.grants ?? [])),
      upsert: mock(() => Promise.resolve({})),
      delete: mock(() => Promise.resolve({})),
    },
    member: {
      findFirst: mock(() => Promise.resolve(opts.member ?? null)),
      findMany: mock(() => Promise.resolve(opts.members ?? [])),
    },
    $transaction: mock((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { service: new McpAuthService(prisma as never), prisma };
}

const token = { accessToken: "tok", userId: "u1", clientId: "c1", accessTokenExpiresAt: future };
const grant = { id: "g1", userId: "u1", clientId: "c1", organizationId: "org1", user, organization };
const owner = { id: "m1", userId: "u1", organizationId: "org1", role: "owner" };

describe("McpAuthService.resolve", () => {
  it("returns the actor for a live token with a grant and an admin-level member", async () => {
    const { service } = build({ token, grant, member: owner });
    const actor = await service.resolve("tok");
    expect(actor?.user.id).toBe("u1");
    expect(actor?.organization.id).toBe("org1");
    expect(actor?.member.role).toBe("owner");
    expect(actor?.oauthClientId).toBe("c1");
  });

  it("returns null for an unknown token", async () => {
    expect(await build().service.resolve("nope")).toBeNull();
  });

  it("returns null for an expired token (the plugin's own lookup does not check)", async () => {
    const { service } = build({ token: { ...token, accessTokenExpiresAt: past }, grant, member: owner });
    expect(await service.resolve("tok")).toBeNull();
  });

  it("returns null when there is no grant, or the user is no longer owner/admin", async () => {
    expect(await build({ token, member: owner }).service.resolve("tok")).toBeNull();
    expect(await build({ token, grant, member: { ...owner, role: "member" } }).service.resolve("tok")).toBeNull();
    expect(await build({ token, grant }).service.resolve("tok")).toBeNull();
  });
});

describe("McpAuthService grants", () => {
  it("saveGrant refuses an org where the user is not owner or admin", async () => {
    const { service, prisma } = build({ app: { clientId: "c1" }, member: { ...owner, role: "member" } });
    await expect(service.saveGrant("u1", "c1", "org1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.mcpGrant.upsert).not.toHaveBeenCalled();
  });

  it("saveGrant refuses an unknown client", async () => {
    const { service } = build({ member: owner });
    await expect(service.saveGrant("u1", "ghost", "org1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("saveGrant upserts on (userId, clientId) so re-consent can move the workspace", async () => {
    const { service, prisma } = build({ app: { clientId: "c1" }, member: owner });
    await service.saveGrant("u1", "c1", "org1");
    const args = prisma.mcpGrant.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ userId_clientId: { userId: "u1", clientId: "c1" } });
    expect(args.update).toEqual({ organizationId: "org1" });
  });

  it("revokeGrant deletes the grant, consent, and tokens for that user and client", async () => {
    const { service, prisma } = build({ grant });
    await service.revokeGrant("g1", "u1", "org1", "admin");
    expect(prisma.oauthAccessToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", clientId: "c1" } });
    expect(prisma.oauthConsent.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", clientId: "c1" } });
    expect(prisma.mcpGrant.delete).toHaveBeenCalledWith({ where: { id: "g1" } });
  });

  it("revokeGrant lets only the owner disconnect someone else's app", async () => {
    const others = { ...grant, userId: "u2" };
    await expect(build({ grant: others }).service.revokeGrant("g1", "u1", "org1", "admin")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(build({ grant: others }).service.revokeGrant("g1", "u1", "org1", "owner")).resolves.toBeUndefined();
  });
});

describe("McpAuthService.adminOrganizations", () => {
  it("returns only owner/admin memberships, mapped to id/name", async () => {
    const members = [
      { organization: { id: "org1", name: "Acme" } },
      { organization: { id: "org2", name: "Beta" } },
    ];
    const { service, prisma } = build({ members });
    const orgs = await service.adminOrganizations("u1");
    expect(orgs).toEqual([
      { id: "org1", name: "Acme" },
      { id: "org2", name: "Beta" },
    ]);
    const args = prisma.member.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: "u1", role: { in: ["owner", "admin"] } });
  });
});

describe("McpAuthService.listGrants", () => {
  const grantRow = (overrides: Record<string, unknown> = {}) => ({
    id: "g1",
    userId: "u1",
    clientId: "c1",
    organizationId: "org1",
    createdAt: new Date(),
    user: { name: "Ada" },
    organization: { name: "Acme" },
    ...overrides,
  });

  it("admin sees only their own grants", async () => {
    const { service, prisma } = build({ grants: [grantRow()], apps: [{ clientId: "c1", name: "Tool" }] });
    const result = await service.listGrants("u1", "org1", "admin");
    expect(result).toEqual([
      {
        id: "g1",
        clientName: "Tool",
        organizationName: "Acme",
        userName: "Ada",
        createdAt: result[0].createdAt,
        mine: true,
      },
    ]);
    const args = prisma.mcpGrant.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ organizationId: "org1", userId: "u1" });
  });

  it("owner sees all grants in the org, with mine flag set accordingly", async () => {
    const rows = [grantRow({ id: "g1", userId: "u1" }), grantRow({ id: "g2", userId: "u2", user: { name: "Bob" } })];
    const { service, prisma } = build({ grants: rows, apps: [{ clientId: "c1", name: "Tool" }] });
    const result = await service.listGrants("u1", "org1", "owner");
    expect(result.map((g) => g.mine)).toEqual([true, false]);
    const args = prisma.mcpGrant.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ organizationId: "org1" });
  });

  it("falls back to 'Unknown app' for a client with no matching application", async () => {
    const { service } = build({ grants: [grantRow()], apps: [] });
    const result = await service.listGrants("u1", "org1", "owner");
    expect(result[0].clientName).toBe("Unknown app");
  });
});
