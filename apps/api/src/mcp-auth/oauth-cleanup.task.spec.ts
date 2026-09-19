import { describe, expect, it, mock } from "bun:test";
import { OAuthCleanupTask } from "./oauth-cleanup.task";

describe("OAuthCleanupTask", () => {
  it("prunes only old clients with no tokens and no grants", async () => {
    const prisma = {
      mcpGrant: { findMany: mock(() => Promise.resolve([{ clientId: "kept-by-grant" }])) },
      oauthApplication: { deleteMany: mock(() => Promise.resolve({ count: 2 })) },
    };
    await new OAuthCleanupTask(prisma as never).pruneUnusedClients();

    const where = prisma.oauthApplication.deleteMany.mock.calls[0][0].where;
    expect(where.accessTokens).toEqual({ none: {} });
    expect(where.clientId).toEqual({ notIn: ["kept-by-grant"] });
    const ageMs: number = Date.now() - where.createdAt.lt.getTime();
    expect(Math.round(ageMs / 86_400_000)).toBe(7);
  });
});
