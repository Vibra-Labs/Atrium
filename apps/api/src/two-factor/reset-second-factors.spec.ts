import { describe, expect, it, mock } from "bun:test";
import type { PrismaService } from "../prisma/prisma.service";
import { resetSecondFactors } from "./reset-second-factors";

function fakePrisma(hadTwoFactor: boolean) {
  const tx = {
    twoFactor: { deleteMany: mock(() => Promise.resolve({ count: hadTwoFactor ? 1 : 0 })) },
    user: { update: mock(() => Promise.resolve({})) },
    session: { deleteMany: mock(() => Promise.resolve({ count: 2 })) },
    verification: { deleteMany: mock(() => Promise.resolve({ count: 1 })) },
  };
  const prisma = {
    $transaction: mock(async (fn: (t: typeof tx) => Promise<unknown>): Promise<unknown> => fn(tx)),
  };
  return { prisma: prisma as unknown as PrismaService, tx, transaction: prisma.$transaction };
}

describe("resetSecondFactors", () => {
  it("removes TOTP, recovery codes, sessions and trusted devices in one transaction", async () => {
    const { prisma, tx, transaction } = fakePrisma(true);
    const result = await resetSecondFactors(prisma, "u1");
    expect(result).toEqual({ hadTwoFactor: true });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.twoFactor.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { twoFactorEnabled: false } });
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(tx.verification.deleteMany).toHaveBeenCalledWith({
      where: { identifier: { startsWith: "trust-device-" }, value: "u1" },
    });
  });

  it("reports when there was no 2FA to remove", async () => {
    const { prisma } = fakePrisma(false);
    expect(await resetSecondFactors(prisma, "u1")).toEqual({ hadTwoFactor: false });
  });
});
