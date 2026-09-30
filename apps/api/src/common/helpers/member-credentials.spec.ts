import { describe, expect, it, mock } from "bun:test";
import { revokeCredentialsIfDemoted, revokeMemberCredentials } from "./member-credentials";

function buildPrisma() {
  return {
    apiKey: { updateMany: mock(() => Promise.resolve({ count: 2 })) },
    mcpGrant: { deleteMany: mock(() => Promise.resolve({ count: 1 })) },
  };
}

describe("revokeMemberCredentials", () => {
  it("revokes the member's live API keys and drops its MCP grants", async () => {
    const prisma = buildPrisma();

    await Promise.all(revokeMemberCredentials(prisma as never, "m1"));

    const keyArgs = prisma.apiKey.updateMany.mock.calls[0][0] as {
      where: unknown;
      data: { revokedAt: Date };
    };
    expect(keyArgs.where).toEqual({ memberId: "m1", revokedAt: null });
    expect(keyArgs.data.revokedAt).toBeInstanceOf(Date);
    expect(prisma.mcpGrant.deleteMany).toHaveBeenCalledWith({ where: { memberId: "m1" } });
  });
});

describe("revokeCredentialsIfDemoted", () => {
  it("revokes in one transaction when the new role cannot hold credentials", async () => {
    const prisma = { ...buildPrisma(), $transaction: mock((ops: Promise<unknown>[]) => Promise.all(ops)) };

    await revokeCredentialsIfDemoted(prisma as never, { id: "m1", role: "member" });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.mcpGrant.deleteMany).toHaveBeenCalledWith({ where: { memberId: "m1" } });
  });

  it("does nothing for owners and admins", async () => {
    const prisma = { ...buildPrisma(), $transaction: mock((ops: Promise<unknown>[]) => Promise.all(ops)) };

    await revokeCredentialsIfDemoted(prisma as never, { id: "m1", role: "admin" });
    await revokeCredentialsIfDemoted(prisma as never, { id: "m1", role: "owner" });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
