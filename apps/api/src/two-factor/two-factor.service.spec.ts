import { describe, expect, it, mock, beforeEach } from "bun:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { TwoFactorService } from "./two-factor.service";

const mockLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
};

const mockPrisma = {
  user: {
    findUnique: mock(() => Promise.resolve(null) as Promise<unknown>),
    update: mock(() => Promise.resolve({}) as Promise<unknown>),
  },
  member: {
    findFirst: mock(() => Promise.resolve(null) as Promise<unknown>),
  },
  systemSettings: {
    findUnique: mock(() => Promise.resolve(null) as Promise<unknown>),
  },
  twoFactor: {
    findFirst: mock(() => Promise.resolve(null) as Promise<unknown>),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
};

function clearMocks() {
  for (const model of Object.values(mockPrisma)) {
    for (const fn of Object.values(model)) {
      (fn as ReturnType<typeof mock>).mockClear();
    }
  }
  mockLogger.info.mockClear();
  mockLogger.warn.mockClear();
}

function buildService() {
  return new TwoFactorService(
    mockPrisma as unknown as PrismaService,
    mockLogger as unknown as Parameters<typeof TwoFactorService>[1],
  );
}

describe("TwoFactorService", () => {
  beforeEach(clearMocks);

  describe("getStatus", () => {
    it("returns enabled=false, requiredByOrg=false when nothing configured", async () => {
      mockPrisma.user.findUnique = mock(() =>
        Promise.resolve({ twoFactorEnabled: false }),
      );
      mockPrisma.systemSettings.findUnique = mock(() => Promise.resolve(null));

      const result = await buildService().getStatus("u1", "org-1");

      expect(result).toEqual({
        enabled: false,
        requiredByOrg: false,
      });
    });

    it("returns enabled=true when the user has 2FA on", async () => {
      mockPrisma.user.findUnique = mock(() =>
        Promise.resolve({ twoFactorEnabled: true }),
      );
      mockPrisma.systemSettings.findUnique = mock(() =>
        Promise.resolve({ requireTwoFactor: true }),
      );

      const result = await buildService().getStatus("u1", "org-1");

      expect(result).toEqual({
        enabled: true,
        requiredByOrg: true,
      });
    });

    it("treats missing user row as enabled=false", async () => {
      mockPrisma.user.findUnique = mock(() => Promise.resolve(null));

      const result = await buildService().getStatus("u-missing", "org-1");

      expect(result.enabled).toBe(false);
    });
  });

  describe("disableForUser", () => {
    it("rejects when actor and target are in different organizations", async () => {
      mockPrisma.member.findFirst = mock((args: unknown) => {
        const where = (args as { where: { userId: string; organizationId: string } }).where;
        if (where.userId === "actor" && where.organizationId === "org-1") {
          return Promise.resolve({ role: "owner" });
        }
        return Promise.resolve(null);
      });

      await expect(
        buildService().disableForUser("actor", "target", "org-1"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects when actor is not owner/admin in the org", async () => {
      mockPrisma.member.findFirst = mock((args: unknown) => {
        const where = (args as { where: { userId: string; organizationId: string } }).where;
        if (where.userId === "actor") return Promise.resolve({ role: "member" });
        return Promise.resolve({ role: "member" });
      });

      await expect(
        buildService().disableForUser("actor", "target", "org-1"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("clears the twoFactor row and User.twoFactorEnabled, then logs", async () => {
      mockPrisma.member.findFirst = mock((args: unknown) => {
        const where = (args as { where: { userId: string; organizationId: string } }).where;
        if (where.userId === "actor") return Promise.resolve({ role: "owner" });
        if (where.userId === "target") return Promise.resolve({ role: "admin" });
        return Promise.resolve(null);
      });
      mockPrisma.twoFactor.deleteMany = mock(() => Promise.resolve({ count: 1 }));
      mockPrisma.user.update = mock(() =>
        Promise.resolve({ id: "target", twoFactorEnabled: false }),
      );

      await buildService().disableForUser("actor", "target", "org-1");

      expect(mockPrisma.twoFactor.deleteMany).toHaveBeenCalledWith({
        where: { userId: "target" },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: "target" },
        data: { twoFactorEnabled: false },
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "two_factor.admin_disabled",
          actorId: "actor",
          targetUserId: "target",
          organizationId: "org-1",
        }),
        expect.any(String),
      );
    });

    it("rejects when actor tries to disable their own 2FA via this endpoint", async () => {
      mockPrisma.member.findFirst = mock(() =>
        Promise.resolve({ role: "owner" }),
      );

      await expect(
        buildService().disableForUser("actor", "actor", "org-1"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
