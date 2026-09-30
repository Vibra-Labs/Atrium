import { describe, expect, it, mock, spyOn } from "bun:test";
import { Logger } from "@nestjs/common";
import { APIError } from "better-auth/api";
import {
  applyConsentOutcome,
  assertConsentGranted,
  discardPendingGrant,
  guardTokenExchange,
  promoteGrantOnConsent,
} from "./consent-hooks";
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
    member: {
      findFirst: mock(() =>
        Promise.resolve(opts.member === undefined ? { id: "m1", role: "admin" } : opts.member)),
    },
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
    expect(args.create).toEqual({ userId: "u1", clientId: "c1", organizationId: "org1", memberId: "m1" });
    expect(args.update).toEqual({ organizationId: "org1", memberId: "m1" });
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

  it("refuses to promote when the user is no longer an owner or admin of the workspace", async () => {
    // Demoted or removed between the consent screen and Allow.
    for (const member of [null, { id: "m1", role: "member" }]) {
      const prisma = grantPrisma({ pending, member });
      await promoteGrantOnConsent(prisma as never, "code-1", "u1");
      expect(prisma.mcpGrant.upsert).not.toHaveBeenCalled();
      expect(prisma.member.findFirst).toHaveBeenCalledWith({
        where: { userId: "u1", organizationId: "org1" },
      });
    }
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

/** Records which identifier was looked up, so the coercion can be asserted. */
function verificationPrisma(value: string) {
  const seen: string[] = [];
  const prisma = {
    verification: {
      findFirst: mock((args: { where: { identifier: string } }) => {
        seen.push(args.where.identifier);
        return Promise.resolve({ value });
      }),
    },
  };
  return { prisma, seen };
}

const NEEDS_CONSENT = JSON.stringify({ clientId: "c1", requireConsent: true });

describe("guardTokenExchange", () => {
  it("refuses a string code that has not been consented to", async () => {
    const { prisma } = verificationPrisma(NEEDS_CONSENT);
    await expect(
      guardTokenExchange(prisma as never, { grant_type: "authorization_code", code: "code-1" }),
    ).rejects.toBeInstanceOf(APIError);
  });

  it("refuses a code smuggled inside an array, the way the plugin coerces it", async () => {
    // A JSON body may carry any shape: the plugin does `code.toString()`, so
    // ["code-1"] reaches the same verification row.
    const { prisma, seen } = verificationPrisma(NEEDS_CONSENT);
    await expect(
      guardTokenExchange(prisma as never, { grant_type: "authorization_code", code: ["code-1"] }),
    ).rejects.toBeInstanceOf(APIError);
    expect(seen).toEqual(["code-1"]);
  });

  it("coerces a non-string code the same way the plugin does", async () => {
    const { prisma, seen } = verificationPrisma(NEEDS_CONSENT);
    await expect(
      guardTokenExchange(prisma as never, { grant_type: "authorization_code", code: 12345 }),
    ).rejects.toBeInstanceOf(APIError);
    expect(seen).toEqual(["12345"]);
  });

  it("checks a code exchange whose grant_type is an array, because the plugin would too", async () => {
    // The plugin compares `grant_type === "refresh_token"` strictly, so
    // ["refresh_token"] is not a refresh and falls through to the code path.
    const { prisma } = verificationPrisma(NEEDS_CONSENT);
    await expect(
      guardTokenExchange(prisma as never, { grant_type: ["refresh_token"], code: "code-1" }),
    ).rejects.toBeInstanceOf(APIError);
  });

  it("checks a code exchange that omits grant_type entirely", async () => {
    const { prisma } = verificationPrisma(NEEDS_CONSENT);
    await expect(guardTokenExchange(prisma as never, { code: "code-1" })).rejects.toBeInstanceOf(
      APIError,
    );
  });

  it("leaves a genuine refresh grant alone", async () => {
    const { prisma, seen } = verificationPrisma(NEEDS_CONSENT);
    await guardTokenExchange(prisma as never, {
      grant_type: "refresh_token",
      refresh_token: "r1",
      code: "code-1",
    });
    expect(seen).toEqual([]);
  });

  it("does nothing when there is no code to check", async () => {
    const { prisma, seen } = verificationPrisma(NEEDS_CONSENT);
    await guardTokenExchange(prisma as never, { grant_type: "authorization_code" });
    await guardTokenExchange(prisma as never, { grant_type: "authorization_code", code: "" });
    await guardTokenExchange(prisma as never, undefined);
    expect(seen).toEqual([]);
  });

  it("allows a code the consent endpoint has already approved", async () => {
    const { prisma } = verificationPrisma(JSON.stringify({ clientId: "c1", requireConsent: false }));
    expect(
      await guardTokenExchange(prisma as never, {
        grant_type: "authorization_code",
        code: ["code-1"],
      }),
    ).toBeUndefined();
  });
});

describe("applyConsentOutcome", () => {
  it("promotes the parked choice when the endpoint succeeded and Allow was pressed", async () => {
    const prisma = grantPrisma({ pending });
    await applyConsentOutcome(prisma as never, {
      returned: { redirectURI: "https://client.test/cb?code=x" },
      body: { accept: true, consent_code: "code-1" },
      sessionUserId: "u1",
    });
    expect(prisma.mcpGrant.upsert).toHaveBeenCalledTimes(1);
  });

  it("promotes nothing and leaves the parked row when the endpoint failed", async () => {
    const prisma = grantPrisma({ pending });
    await applyConsentOutcome(prisma as never, {
      returned: new APIError("UNAUTHORIZED", { error: "invalid_request" }),
      body: { accept: true, consent_code: "code-1" },
      sessionUserId: "u1",
    });
    expect(prisma.mcpGrant.upsert).not.toHaveBeenCalled();
    expect(prisma.mcpPendingGrant.delete).not.toHaveBeenCalled();
    expect(prisma.mcpPendingGrant.deleteMany).not.toHaveBeenCalled();
  });

  it("discards the parked choice on Deny", async () => {
    const prisma = grantPrisma({ pending });
    await applyConsentOutcome(prisma as never, {
      returned: { redirectURI: "https://client.test/cb?error=access_denied" },
      body: { accept: false, consent_code: "code-1" },
      sessionUserId: "u1",
    });
    expect(prisma.mcpPendingGrant.deleteMany).toHaveBeenCalledWith({
      where: { consentCode: "code-1" },
    });
    expect(prisma.mcpGrant.upsert).not.toHaveBeenCalled();
  });

  it("does nothing without a consent code or without a session user", async () => {
    const noCode = grantPrisma({ pending });
    await applyConsentOutcome(noCode as never, {
      returned: {},
      body: { accept: true },
      sessionUserId: "u1",
    });
    expect(noCode.mcpGrant.upsert).not.toHaveBeenCalled();

    const noUser = grantPrisma({ pending });
    await applyConsentOutcome(noUser as never, {
      returned: {},
      body: { accept: true, consent_code: "code-1" },
      sessionUserId: undefined,
    });
    expect(noUser.mcpGrant.upsert).not.toHaveBeenCalled();
  });

  it("logs and rethrows when the promotion itself fails", async () => {
    const prisma = grantPrisma({ pending });
    prisma.$transaction = mock(() => Promise.reject(new Error("db down"))) as never;
    const error = spyOn(Logger.prototype, "error").mockImplementation(() => {});

    try {
      await expect(
        applyConsentOutcome(prisma as never, {
          returned: {},
          body: { accept: true, consent_code: "code-1" },
          sessionUserId: "u1",
        }),
      ).rejects.toThrow("db down");

      const logged: string = error.mock.calls.flat().map(String).join(" ");
      expect(error).toHaveBeenCalled();
      expect(logged).toContain("c1");
      expect(logged).toContain("u1");
      // The consent code is exchangeable; it must never reach the logs.
      expect(logged).not.toContain("code-1");
    } finally {
      error.mockRestore();
    }
  });
});
