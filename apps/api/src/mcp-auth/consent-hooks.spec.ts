import { describe, expect, it, mock, spyOn } from "bun:test";
import { Logger } from "@nestjs/common";
import { APIError } from "better-auth/api";
import { makeSignature } from "better-auth/crypto";
import { applyConsentOutcome, promoteGrantOnConsent } from "./consent-hooks";

const SECRET: string = "s".repeat(32);

/** Signs a query the way Better Auth signs the consent page's URL. */
async function signed(params: Record<string, string>): Promise<string> {
  const query = new URLSearchParams(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)));
  query.set("sig", await makeSignature(query.toString(), SECRET));
  return query.toString();
}

const exp: string = String(Math.floor(Date.now() / 1000) + 600);

interface GrantPrismaOpts {
  pending?: { requestId: string; userId: string; clientId: string; organizationId: string } | null;
  grant?: { organizationId: string } | null;
  member?: { id: string; role: string } | null;
}

function grantPrisma(opts: GrantPrismaOpts = {}) {
  const prisma = {
    mcpPendingGrant: {
      findUnique: mock(() => Promise.resolve(opts.pending ?? null)),
      delete: mock(() => Promise.resolve({})),
      deleteMany: mock(() => Promise.resolve({ count: 1 })),
    },
    mcpGrant: {
      findUnique: mock(() => Promise.resolve(opts.grant ?? null)),
      upsert: mock(() => Promise.resolve({})),
    },
    oauthAccessToken: { deleteMany: mock(() => Promise.resolve({ count: 1 })) },
    oauthRefreshToken: { deleteMany: mock(() => Promise.resolve({ count: 1 })) },
    member: {
      findFirst: mock(() =>
        Promise.resolve(opts.member === undefined ? { id: "m1", role: "admin" } : opts.member)),
    },
    $transaction: mock((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return prisma;
}

const pending = { requestId: "sig-1", userId: "u1", clientId: "c1", organizationId: "org1" };
const request = { requestId: "sig-1", clientId: "c1", redirectURI: "https://client.test/cb", expiresAt: new Date() };
const pendingKey = { requestId_userId: { requestId: "sig-1", userId: "u1" } };

describe("promoteGrantOnConsent", () => {
  it("writes the grant the pending row records and clears the row", async () => {
    const prisma = grantPrisma({ pending });

    await promoteGrantOnConsent(prisma as never, request, "u1");

    const args = prisma.mcpGrant.upsert.mock.calls[0][0] as {
      where: unknown;
      create: unknown;
      update: unknown;
    };
    expect(args.where).toEqual({ userId_clientId: { userId: "u1", clientId: "c1" } });
    expect(args.create).toEqual({ userId: "u1", clientId: "c1", organizationId: "org1", memberId: "m1" });
    expect(args.update).toEqual({ organizationId: "org1", memberId: "m1" });
    expect(prisma.mcpPendingGrant.findUnique).toHaveBeenCalledWith({ where: pendingKey });
    expect(prisma.mcpPendingGrant.delete).toHaveBeenCalledWith({ where: pendingKey });
    expect(prisma.oauthAccessToken.deleteMany).not.toHaveBeenCalled();
    // The grant and the pending row land together, so consent cannot half-apply.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is no pending row", async () => {
    const prisma = grantPrisma({ pending: null });
    await promoteGrantOnConsent(prisma as never, request, "u1");
    expect(prisma.mcpGrant.upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("only looks for a row the consenting user parked", async () => {
    const prisma = grantPrisma({ pending: null });
    await promoteGrantOnConsent(prisma as never, request, "u2");
    expect(prisma.mcpPendingGrant.findUnique).toHaveBeenCalledWith({
      where: { requestId_userId: { requestId: "sig-1", userId: "u2" } },
    });
    expect(prisma.mcpGrant.upsert).not.toHaveBeenCalled();
  });

  it("refuses to promote a row parked for a different client", async () => {
    const prisma = grantPrisma({ pending: { ...pending, clientId: "c-other" } });
    const warn = spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    try {
      await promoteGrantOnConsent(prisma as never, request, "u1");
    } finally {
      warn.mockRestore();
    }
    expect(prisma.mcpGrant.upsert).not.toHaveBeenCalled();
    expect(prisma.mcpPendingGrant.delete).not.toHaveBeenCalled();
  });

  it("refuses to promote when the user is no longer an owner or admin of the workspace", async () => {
    // Demoted or removed between the consent screen and Allow.
    const warn = spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    for (const member of [null, { id: "m1", role: "member" }]) {
      const prisma = grantPrisma({ pending, member });
      await promoteGrantOnConsent(prisma as never, request, "u1");
      expect(prisma.mcpGrant.upsert).not.toHaveBeenCalled();
      expect(prisma.member.findFirst).toHaveBeenCalledWith({
        where: { userId: "u1", organizationId: "org1" },
      });
    }
    warn.mockRestore();
  });

  it("signs older sessions out when the workspace actually moves", async () => {
    const prisma = grantPrisma({ pending, grant: { organizationId: "org-old" } });
    await promoteGrantOnConsent(prisma as never, request, "u1");
    const scope = { where: { userId: "u1", clientId: "c1" } };
    expect(prisma.oauthAccessToken.deleteMany).toHaveBeenCalledWith(scope);
    expect(prisma.oauthRefreshToken.deleteMany).toHaveBeenCalledWith(scope);
  });

  it("leaves tokens alone when the workspace is unchanged", async () => {
    const prisma = grantPrisma({ pending, grant: { organizationId: "org1" } });
    await promoteGrantOnConsent(prisma as never, request, "u1");
    expect(prisma.oauthAccessToken.deleteMany).not.toHaveBeenCalled();
    expect(prisma.mcpGrant.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("applyConsentOutcome", () => {
  const base = { client_id: "c1", redirect_uri: "https://client.test/cb", exp };

  it("promotes the parked choice when the endpoint succeeded and Allow was pressed", async () => {
    const prisma = grantPrisma({ pending });
    const oauthQuery: string = await signed(base);
    await applyConsentOutcome(prisma as never, SECRET, {
      returned: { redirect: true, url: "https://client.test/cb?code=x" },
      body: { accept: true, oauth_query: oauthQuery },
      sessionUserId: "u1",
    });
    expect(prisma.mcpGrant.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.mcpPendingGrant.findUnique).toHaveBeenCalledWith({
      where: { requestId_userId: { requestId: new URLSearchParams(oauthQuery).get("sig")!, userId: "u1" } },
    });
  });

  it("promotes nothing and leaves the parked row when the endpoint failed", async () => {
    const prisma = grantPrisma({ pending });
    await applyConsentOutcome(prisma as never, SECRET, {
      returned: new APIError("UNAUTHORIZED", { error: "invalid_request" }),
      body: { accept: true, oauth_query: await signed(base) },
      sessionUserId: "u1",
    });
    expect(prisma.mcpPendingGrant.findUnique).not.toHaveBeenCalled();
    expect(prisma.mcpPendingGrant.deleteMany).not.toHaveBeenCalled();
  });

  it("ignores a request whose signature does not check out", async () => {
    const prisma = grantPrisma({ pending });
    const tampered: string = (await signed(base)).replace("client_id=c1", "client_id=c2");
    await applyConsentOutcome(prisma as never, SECRET, {
      returned: {},
      body: { accept: true, oauth_query: tampered },
      sessionUserId: "u1",
    });
    expect(prisma.mcpPendingGrant.findUnique).not.toHaveBeenCalled();
  });

  it("discards the user's parked choice on Deny", async () => {
    const prisma = grantPrisma({ pending });
    const oauthQuery: string = await signed(base);
    await applyConsentOutcome(prisma as never, SECRET, {
      returned: { redirect: true, url: "https://client.test/cb?error=access_denied" },
      body: { accept: false, oauth_query: oauthQuery },
      sessionUserId: "u1",
    });
    expect(prisma.mcpPendingGrant.deleteMany).toHaveBeenCalledWith({
      where: { requestId: new URLSearchParams(oauthQuery).get("sig")!, userId: "u1" },
    });
    expect(prisma.mcpGrant.upsert).not.toHaveBeenCalled();
  });

  it("does nothing without a signed request or without a session user", async () => {
    const noQuery = grantPrisma({ pending });
    await applyConsentOutcome(noQuery as never, SECRET, { returned: {}, body: { accept: true }, sessionUserId: "u1" });
    expect(noQuery.mcpPendingGrant.findUnique).not.toHaveBeenCalled();

    const noUser = grantPrisma({ pending });
    await applyConsentOutcome(noUser as never, SECRET, {
      returned: {},
      body: { accept: true, oauth_query: await signed(base) },
      sessionUserId: undefined,
    });
    expect(noUser.mcpPendingGrant.findUnique).not.toHaveBeenCalled();
  });

  it("logs and rethrows when the promotion itself fails", async () => {
    const prisma = grantPrisma({ pending });
    prisma.$transaction = mock(() => Promise.reject(new Error("db down"))) as never;
    const error = spyOn(Logger.prototype, "error").mockImplementation(() => {});

    try {
      await expect(
        applyConsentOutcome(prisma as never, SECRET, {
          returned: {},
          body: { accept: true, oauth_query: await signed(base) },
          sessionUserId: "u1",
        }),
      ).rejects.toThrow("db down");

      const logged: string = error.mock.calls.flat().map(String).join(" ");
      expect(logged).toContain("c1");
      expect(logged).toContain("u1");
    } finally {
      error.mockRestore();
    }
  });
});
