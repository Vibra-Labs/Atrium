import { describe, expect, it, mock } from "bun:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { makeSignature } from "better-auth/crypto";
import { McpAuthService } from "./mcp-auth.service";
import { hashOAuthToken, ORG_MEMBER_FIELDS } from "../common";

const SECRET: string = "s".repeat(32);

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
    oauthRefreshToken: { deleteMany: mock(() => Promise.resolve({ count: 1 })) },
    oauthConsent: { deleteMany: mock(() => Promise.resolve({ count: 1 })) },
    oauthClient: {
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
    mcpPendingGrant: {
      upsert: mock(() => Promise.resolve({})),
    },
    member: {
      findFirst: mock(() => Promise.resolve(opts.member ?? null)),
      findMany: mock(() => Promise.resolve(opts.members ?? [])),
    },
    $transaction: mock((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const config = { getOrThrow: () => SECRET };
  const service = new McpAuthService(prisma as never, config as never);
  return { service, prisma };
}

const token = { token: hashOAuthToken("tok"), userId: "u1", clientId: "c1", expiresAt: future, revoked: null, confirmation: null };
const grant = { id: "g1", userId: "u1", clientId: "c1", organizationId: "org1", memberId: "m1", user, organization };
const owner = { id: "m1", userId: "u1", organizationId: "org1", role: "owner" };

describe("McpAuthService.resolve", () => {
  it("returns the actor for a live token with a grant and an admin-level member", async () => {
    const { service, prisma } = build({ token, grant, member: owner });
    const actor = await service.resolve("tok");
    // Tokens are stored hashed, so the lookup is by hash.
    expect(prisma.oauthAccessToken.findUnique).toHaveBeenCalledWith({ where: { token: hashOAuthToken("tok") } });
    expect(actor?.user.id).toBe("u1");
    expect(actor?.organization.id).toBe("org1");
    expect(actor?.member.role).toBe("owner");
    expect(actor?.oauthClientId).toBe("c1");
  });

  it("checks the membership row the grant was issued to, not any row for that user", async () => {
    const { service, prisma } = build({ token, grant, member: owner });
    await service.resolve("tok");
    expect(prisma.member.findFirst).toHaveBeenCalledWith({
      where: { id: "m1", userId: "u1", organizationId: "org1" },
      select: ORG_MEMBER_FIELDS,
    });
  });

  it("returns null for an unknown token", async () => {
    expect(await build().service.resolve("nope")).toBeNull();
  });

  it("returns null for an expired, revoked or DPoP-bound token", async () => {
    for (const row of [
      { ...token, expiresAt: past },
      { ...token, revoked: past },
      { ...token, confirmation: { jkt: "k" } },
    ]) {
      expect(await build({ token: row, grant, member: owner }).service.resolve("tok")).toBeNull();
    }
  });

  it("returns null when there is no grant, or the user is no longer owner/admin", async () => {
    expect(await build({ token, member: owner }).service.resolve("tok")).toBeNull();
    expect(await build({ token, grant, member: { ...owner, role: "member" } }).service.resolve("tok")).toBeNull();
    expect(await build({ token, grant }).service.resolve("tok")).toBeNull();
  });
});

describe("McpAuthService grants", () => {
  const request = { requestId: "sig1", clientId: "c1", redirectURI: "https://claude.ai/cb", expiresAt: future };

  it("savePendingGrant refuses an org where the user is not owner or admin", async () => {
    const { service, prisma } = build({ app: { clientId: "c1" }, member: { ...owner, role: "member" } });
    await expect(service.savePendingGrant(request, "u1", "org1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.mcpPendingGrant.upsert).not.toHaveBeenCalled();
  });

  it("savePendingGrant refuses an unknown client", async () => {
    const { service, prisma } = build({ member: owner });
    await expect(
      service.savePendingGrant({ ...request, clientId: "ghost" }, "u1", "org1"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.mcpPendingGrant.upsert).not.toHaveBeenCalled();
  });

  it("savePendingGrant parks the choice for this request and user, touching no grant", async () => {
    // Pressing Allow is what turns this into a grant; until then an existing
    // connection must keep working exactly as it did.
    const { service, prisma } = build({ app: { clientId: "c1" }, member: owner });
    await service.savePendingGrant(request, "u1", "org1");
    const args = prisma.mcpPendingGrant.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ requestId_userId: { requestId: "sig1", userId: "u1" } });
    expect(args.create).toEqual({
      requestId: "sig1",
      userId: "u1",
      clientId: "c1",
      organizationId: "org1",
      expiresAt: future,
    });
    expect(args.update).toEqual({ clientId: "c1", organizationId: "org1", expiresAt: future });
    expect(prisma.mcpGrant.upsert).not.toHaveBeenCalled();
    expect(prisma.oauthAccessToken.deleteMany).not.toHaveBeenCalled();
  });

  it("revokeGrant deletes the grant and tokens, but keeps the consent record", async () => {
    const { service, prisma } = build({ grant });
    await service.revokeGrant("g1", "u1", "org1", "admin");
    expect(prisma.oauthAccessToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", clientId: "c1" } });
    expect(prisma.oauthRefreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", clientId: "c1" } });
    expect(prisma.mcpGrant.delete).toHaveBeenCalledWith({ where: { id: "g1" } });
    // The consent row carries no authority — consent is forced on every
    // authorize and the grant is the gate — but it is what stops the nightly
    // prune from deleting the registration out from under the client.
    expect(prisma.oauthConsent.deleteMany).not.toHaveBeenCalled();
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

describe("McpAuthService.consentRequest", () => {
  /** Signs a query the way Better Auth signs the consent page's URL. */
  async function signed(params: Record<string, string>): Promise<string> {
    const query = new URLSearchParams(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)));
    query.set("sig", await makeSignature(query.toString(), SECRET));
    return query.toString();
  }
  const exp = (date: Date): string => String(Math.floor(date.getTime() / 1000));
  const base = { client_id: "c1", redirect_uri: "https://claude.ai/cb", response_type: "code" };

  it("returns the client and destination the signed request names", async () => {
    const query: string = await signed({ ...base, exp: exp(future) });
    const request = await build().service.consentRequest(query);
    expect(request).toEqual({
      requestId: new URLSearchParams(query).get("sig")!,
      clientId: "c1",
      redirectURI: "https://claude.ai/cb",
      expiresAt: new Date(Number(exp(future)) * 1000),
    });
  });

  it("rejects an unsigned, tampered or expired request", async () => {
    const { service } = build();
    const good: string = await signed({ ...base, exp: exp(future) });
    for (const query of [
      "client_id=c1&redirect_uri=x&exp=9999999999",
      good.replace("client_id=c1", "client_id=c2"),
      await signed({ ...base, exp: exp(past) }),
      await signed({ ...base, exp: exp(future), client_id: "c1" }).then((q) => q.replace(/sig=[^&]+/, "sig=forged")),
    ]) {
      await expect(service.consentRequest(query)).rejects.toBeInstanceOf(NotFoundException);
    }
  });
});
