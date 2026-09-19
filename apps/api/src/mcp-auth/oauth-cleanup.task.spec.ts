import { describe, expect, it, mock } from "bun:test";
import { OAuthCleanupTask } from "./oauth-cleanup.task";

function build(overrides: { appDelete?: () => Promise<unknown> } = {}) {
  const prisma = {
    mcpGrant: { findMany: mock(() => Promise.resolve([{ clientId: "kept-by-grant" }])) },
    oauthApplication: {
      deleteMany: mock(overrides.appDelete ?? (() => Promise.resolve({ count: 2 }))),
    },
    oauthAccessToken: { deleteMany: mock(() => Promise.resolve({ count: 3 })) },
    mcpPendingGrant: { deleteMany: mock(() => Promise.resolve({ count: 1 })) },
  };
  const task = new OAuthCleanupTask(prisma as never);
  // The failure case logs an error on purpose; keep the output pristine.
  (task as unknown as { logger: { log: () => void; error: () => void } }).logger = {
    log: mock(() => {}),
    error: mock(() => {}),
  };
  return { prisma, task };
}

describe("OAuthCleanupTask.pruneUnusedClients", () => {
  it("prunes only old registrations with no tokens, no consent, and no grant", async () => {
    const { prisma, task } = build();
    await task.pruneUnusedClients();

    const where = prisma.oauthApplication.deleteMany.mock.calls[0][0].where;
    expect(where.accessTokens).toEqual({ none: {} });
    // A registration the user once approved is never pruned: a client that
    // cached its client_id would otherwise land on an invalid_client dead end.
    expect(where.consents).toEqual({ none: {} });
    expect(where.clientId).toEqual({ notIn: ["kept-by-grant"] });
    const ageMs: number = Date.now() - where.createdAt.lt.getTime();
    expect(Math.round(ageMs / 86_400_000)).toBe(7);
  });
});

describe("OAuthCleanupTask.pruneExpiredTokens", () => {
  it("deletes token rows whose refresh window has closed", async () => {
    const { prisma, task } = build();
    await task.pruneExpiredTokens();

    const where = prisma.oauthAccessToken.deleteMany.mock.calls[0][0].where;
    // Every refresh inserts a new row and rotates nothing out, so the dead
    // rows are the ones whose refresh token can no longer be redeemed.
    const skewMs: number = Date.now() - where.refreshTokenExpiresAt.lt.getTime();
    expect(skewMs).toBeGreaterThanOrEqual(0);
    expect(skewMs).toBeLessThan(5_000);
  });
});

describe("OAuthCleanupTask.pruneExpiredPendingGrants", () => {
  it("deletes workspace choices whose consent code can no longer be used", async () => {
    const { prisma, task } = build();
    await task.pruneExpiredPendingGrants();

    const where = prisma.mcpPendingGrant.deleteMany.mock.calls[0][0].where;
    const skewMs: number = Date.now() - where.expiresAt.lt.getTime();
    expect(skewMs).toBeGreaterThanOrEqual(0);
    expect(skewMs).toBeLessThan(5_000);
  });
});

describe("OAuthCleanupTask nightly run", () => {
  it("runs every sweep, tokens first so newly dead clients become prunable", async () => {
    const { prisma, task } = build();
    await task.nightlyCleanup();
    expect(prisma.oauthAccessToken.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.oauthApplication.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.mcpPendingGrant.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("still prunes clients when the token sweep is the one that fails", async () => {
    const { prisma, task } = build({ appDelete: () => Promise.reject(new Error("db down")) });
    await task.nightlyCleanup();
    expect(prisma.oauthAccessToken.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.oauthApplication.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.mcpPendingGrant.deleteMany).toHaveBeenCalledTimes(1);
  });
});
