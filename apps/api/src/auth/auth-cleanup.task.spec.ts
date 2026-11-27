import { describe, expect, it, mock } from "bun:test";
import { AuthCleanupTask } from "./auth-cleanup.task";
import type { CreatedAtWhere, ExpiresAtWhere } from "../common/testing/prisma-args";

function build(overrides: { sessionDelete?: (args: unknown) => Promise<unknown> } = {}) {
  const prisma = {
    session: {
      deleteMany: mock(overrides.sessionDelete ?? ((_args: unknown): Promise<unknown> => Promise.resolve({ count: 2 }))),
    },
    verification: { deleteMany: mock((_args: unknown): Promise<unknown> => Promise.resolve({ count: 1 })) },
    invitation: { deleteMany: mock((_args: unknown): Promise<unknown> => Promise.resolve({ count: 3 })) },
  };
  const task = new AuthCleanupTask(prisma as never);
  (task as unknown as { logger: { log: () => void; error: () => void } }).logger = {
    log: mock(() => {}),
    error: mock(() => {}),
  };
  return { prisma, task };
}

describe("AuthCleanupTask", () => {
  it("deletes expired sessions and verifications", async () => {
    const { prisma, task } = build();
    const before = Date.now();
    await task.dailyCleanup();

    const sessionCutoff = (prisma.session.deleteMany.mock.calls[0][0] as ExpiresAtWhere).where.expiresAt.lt;
    const verificationCutoff = (prisma.verification.deleteMany.mock.calls[0][0] as ExpiresAtWhere).where.expiresAt.lt;
    expect(sessionCutoff.getTime()).toBeGreaterThanOrEqual(before);
    expect(verificationCutoff.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("deletes invitations that are no longer pending or have expired, once older than 90 days", async () => {
    const { prisma, task } = build();
    const before = Date.now();
    await task.dailyCleanup();

    const where = (prisma.invitation.deleteMany.mock.calls[0][0] as CreatedAtWhere).where;
    const cutoff = where.createdAt.lt;
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    expect(Math.abs(before - ninetyDays - cutoff.getTime())).toBeLessThan(5000);
    expect(where.OR).toEqual([{ status: { not: "pending" } }, { expiresAt: { lt: expect.any(Date) } }]);
  });

  it("keeps sweeping when one sweep fails", async () => {
    const { prisma, task } = build({ sessionDelete: () => Promise.reject(new Error("boom")) });
    await task.dailyCleanup();

    expect(prisma.verification.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.invitation.deleteMany).toHaveBeenCalledTimes(1);
  });
});
