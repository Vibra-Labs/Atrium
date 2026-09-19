import { describe, expect, it, mock } from "bun:test";
import { APIError } from "better-auth/api";
import { assertConsentGranted, discardPendingGrant, promoteGrantOnConsent } from "./consent-hooks";
import type { PrismaService } from "../prisma/prisma.service";

function prismaWith(row: { value: string } | null): PrismaService {
  return {
    verification: { findFirst: async () => row },
  } as unknown as PrismaService;
}

describe("assertConsentGranted", () => {
  it("refuses a code whose row still requires consent", async () => {
    const prisma = prismaWith({ value: JSON.stringify({ clientId: "c1", requireConsent: true }) });

    const err = await assertConsentGranted(prisma, "code-1").then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(APIError);
    expect((err as APIError).statusCode).toBe(400);
    expect((err as APIError).body).toMatchObject({
      error: "invalid_grant",
      error_description: "Consent has not been granted.",
    });
  });

  it("allows a code the consent endpoint has already flipped", async () => {
    // /oauth2/consent renames the row and sets requireConsent to false.
    const prisma = prismaWith({ value: JSON.stringify({ clientId: "c1", requireConsent: false }) });
    expect(await assertConsentGranted(prisma, "code-1")).toBeUndefined();
  });

  it("leaves an unknown code to the plugin's own invalid_grant answer", async () => {
    expect(await assertConsentGranted(prismaWith(null), "nope")).toBeUndefined();
  });

  it("leaves a row that is not an authorization request alone", async () => {
    expect(await assertConsentGranted(prismaWith({ value: "not json" }), "code-1")).toBeUndefined();
    expect(await assertConsentGranted(prismaWith({ value: '"a string"' }), "code-1")).toBeUndefined();
  });
});

interface GrantPrismaOpts {
  pending?: { consentCode: string; userId: string; clientId: string; organizationId: string } | null;
  grant?: { organizationId: string } | null;
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
    $transaction: mock((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return prisma;
}

const pending = { consentCode: "code-1", userId: "u1", clientId: "c1", organizationId: "org1" };

describe("promoteGrantOnConsent", () => {
  it("writes the grant the pending row records and clears the row", async () => {
    const prisma = grantPrisma({ pending });

    await promoteGrantOnConsent(prisma as never, "code-1", "u1");

    const args = prisma.mcpGrant.upsert.mock.calls[0][0] as {
      where: unknown;
      create: unknown;
      update: unknown;
    };
    expect(args.where).toEqual({ userId_clientId: { userId: "u1", clientId: "c1" } });
    expect(args.create).toEqual({ userId: "u1", clientId: "c1", organizationId: "org1" });
    expect(args.update).toEqual({ organizationId: "org1" });
    expect(prisma.mcpPendingGrant.delete).toHaveBeenCalledWith({ where: { consentCode: "code-1" } });
    expect(prisma.oauthAccessToken.deleteMany).not.toHaveBeenCalled();
    // The grant and the pending row land together, so consent cannot half-apply.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is no pending row", async () => {
    const prisma = grantPrisma({ pending: null });
    await promoteGrantOnConsent(prisma as never, "code-1", "u1");
    expect(prisma.mcpGrant.upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to promote a row another user parked", async () => {
    const prisma = grantPrisma({ pending });
    await promoteGrantOnConsent(prisma as never, "code-1", "u2");
    expect(prisma.mcpGrant.upsert).not.toHaveBeenCalled();
    expect(prisma.mcpPendingGrant.delete).not.toHaveBeenCalled();
  });

  it("signs older sessions out when the workspace actually moves", async () => {
    const prisma = grantPrisma({ pending, grant: { organizationId: "org-old" } });
    await promoteGrantOnConsent(prisma as never, "code-1", "u1");
    expect(prisma.oauthAccessToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", clientId: "c1" },
    });
  });

  it("leaves tokens alone when the workspace is unchanged", async () => {
    const prisma = grantPrisma({ pending, grant: { organizationId: "org1" } });
    await promoteGrantOnConsent(prisma as never, "code-1", "u1");
    expect(prisma.oauthAccessToken.deleteMany).not.toHaveBeenCalled();
    expect(prisma.mcpGrant.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("discardPendingGrant", () => {
  it("removes the row without touching any grant", async () => {
    const prisma = grantPrisma({ pending });
    await discardPendingGrant(prisma as never, "code-1");
    expect(prisma.mcpPendingGrant.deleteMany).toHaveBeenCalledWith({
      where: { consentCode: "code-1" },
    });
    expect(prisma.mcpGrant.upsert).not.toHaveBeenCalled();
  });
});
