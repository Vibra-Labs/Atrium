import { describe, expect, it, mock, beforeEach } from "bun:test";
import { UnauthorizedException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageProvider } from "../files/storage/storage.interface";

// ---------------------------------------------------------------------------
// Mock "better-auth/crypto" before importing the service
// ---------------------------------------------------------------------------
const mockVerifyPassword = mock(() => Promise.resolve(true));

mock.module("better-auth/crypto", () => ({
  verifyPassword: mockVerifyPassword,
}));

// Import AFTER the module mock is registered
import { AccountService } from "./account.service";

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------
const mockPrisma = {
  account: {
    findFirst: mock(() => Promise.resolve({ password: "hashed-pw" })),
  },
  member: {
    findMany: mock(() => Promise.resolve([])),
    groupBy: mock(() => Promise.resolve([])),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  file: {
    findMany: mock(() => Promise.resolve([])),
    updateMany: mock(() => Promise.resolve({ count: 0 })),
  },
  project: {
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  projectStatus: {
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  clientProfile: {
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  branding: {
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  invoice: {
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  subscription: {
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  notification: {
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  pushSubscription: {
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  invitation: {
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  projectUpdate: {
    updateMany: mock(() => Promise.resolve({ count: 0 })),
  },
  projectNote: {
    updateMany: mock(() => Promise.resolve({ count: 0 })),
  },
  organization: {
    delete: mock(() => Promise.resolve()),
  },
  user: {
    delete: mock(() => Promise.resolve()),
  },
  $transaction: mock((fn: (prisma: typeof mockPrisma) => unknown) => fn(mockPrisma)),
};

// ---------------------------------------------------------------------------
// Mock StorageProvider
// ---------------------------------------------------------------------------
const mockStorage = {
  upload: mock(() => Promise.resolve()),
  download: mock(() => Promise.resolve({ body: null, contentType: "" })),
  getSignedUrl: mock(() => Promise.resolve("")),
  delete: mock(() => Promise.resolve()),
};

// ---------------------------------------------------------------------------
// Mock Logger
// ---------------------------------------------------------------------------
const mockLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function clearAllMocks() {
  mockVerifyPassword.mockClear();
  mockPrisma.account.findFirst.mockClear();
  mockPrisma.member.findMany.mockClear();
  mockPrisma.member.groupBy.mockClear();
  mockPrisma.member.deleteMany.mockClear();
  mockPrisma.file.findMany.mockClear();
  mockPrisma.file.updateMany.mockClear();
  mockPrisma.project.deleteMany.mockClear();
  mockPrisma.projectStatus.deleteMany.mockClear();
  mockPrisma.clientProfile.deleteMany.mockClear();
  mockPrisma.branding.deleteMany.mockClear();
  mockPrisma.invoice.deleteMany.mockClear();
  mockPrisma.subscription.deleteMany.mockClear();
  mockPrisma.notification.deleteMany.mockClear();
  mockPrisma.pushSubscription.deleteMany.mockClear();
  mockPrisma.invitation.deleteMany.mockClear();
  mockPrisma.projectUpdate.updateMany.mockClear();
  mockPrisma.projectNote.updateMany.mockClear();
  mockPrisma.organization.delete.mockClear();
  mockPrisma.user.delete.mockClear();
  mockPrisma.$transaction.mockClear();
  mockStorage.delete.mockClear();
  mockLogger.info.mockClear();
  mockLogger.warn.mockClear();

  // Reset default implementations
  mockVerifyPassword.mockImplementation(() => Promise.resolve(true));
  mockPrisma.account.findFirst.mockImplementation(() =>
    Promise.resolve({ password: "hashed-pw" }),
  );
  mockPrisma.member.findMany.mockImplementation(() => Promise.resolve([]));
  mockPrisma.member.groupBy.mockImplementation(() => Promise.resolve([]));
  mockPrisma.file.findMany.mockImplementation(() => Promise.resolve([]));
  mockPrisma.$transaction.mockImplementation(
    (fn: (prisma: typeof mockPrisma) => unknown) => fn(mockPrisma),
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("AccountService", () => {
  let service: AccountService;

  beforeEach(() => {
    clearAllMocks();
    service = new AccountService(
      mockPrisma as unknown as PrismaService,
      mockStorage as unknown as StorageProvider,
      mockLogger as never,
    );
  });

  // =========================================================================
  // getDeletionInfo
  // =========================================================================
  describe("getDeletionInfo", () => {
    it("returns empty ownedOrganizations for non-owner user", async () => {
      mockPrisma.member.findMany.mockImplementation(() => Promise.resolve([]));

      const result = await service.getDeletionInfo("user-1");

      expect(result).toEqual({ ownedOrganizations: [] });
      expect(mockPrisma.member.groupBy).not.toHaveBeenCalled();
    });

    it("returns org info with correct isSoleOwner and memberCount", async () => {
      mockPrisma.member.findMany.mockImplementation(() =>
        Promise.resolve([
          {
            organizationId: "org-1",
            role: "owner",
            organization: { id: "org-1", name: "Acme Corp" },
          },
        ]),
      );

      // First groupBy call: memberCounts; second: ownerCounts
      let groupByCallIndex = 0;
      mockPrisma.member.groupBy.mockImplementation(() => {
        groupByCallIndex++;
        if (groupByCallIndex === 1) {
          // total members
          return Promise.resolve([{ organizationId: "org-1", _count: 3 }]);
        }
        // owner count = 1 => sole owner
        return Promise.resolve([{ organizationId: "org-1", _count: 1 }]);
      });

      const result = await service.getDeletionInfo("user-1");

      expect(result.ownedOrganizations).toHaveLength(1);
      expect(result.ownedOrganizations[0]).toEqual({
        id: "org-1",
        name: "Acme Corp",
        isSoleOwner: true,
        memberCount: 3,
      });
    });

    it("handles multiple owned orgs with different owner counts", async () => {
      mockPrisma.member.findMany.mockImplementation(() =>
        Promise.resolve([
          {
            organizationId: "org-1",
            role: "owner",
            organization: { id: "org-1", name: "Acme Corp" },
          },
          {
            organizationId: "org-2",
            role: "owner",
            organization: { id: "org-2", name: "Beta Inc" },
          },
        ]),
      );

      let groupByCallIndex = 0;
      mockPrisma.member.groupBy.mockImplementation(() => {
        groupByCallIndex++;
        if (groupByCallIndex === 1) {
          // total members per org
          return Promise.resolve([
            { organizationId: "org-1", _count: 5 },
            { organizationId: "org-2", _count: 2 },
          ]);
        }
        // owner counts: org-1 has 1 owner (sole), org-2 has 2 owners (not sole)
        return Promise.resolve([
          { organizationId: "org-1", _count: 1 },
          { organizationId: "org-2", _count: 2 },
        ]);
      });

      const result = await service.getDeletionInfo("user-1");

      expect(result.ownedOrganizations).toHaveLength(2);

      const org1 = result.ownedOrganizations.find((o) => o.id === "org-1")!;
      expect(org1.isSoleOwner).toBe(true);
      expect(org1.memberCount).toBe(5);

      const org2 = result.ownedOrganizations.find((o) => o.id === "org-2")!;
      expect(org2.isSoleOwner).toBe(false);
      expect(org2.memberCount).toBe(2);
    });
  });

  // =========================================================================
  // deleteAccount
  // =========================================================================
  describe("deleteAccount", () => {
    it("throws UnauthorizedException when no credential account exists", async () => {
      mockPrisma.account.findFirst.mockImplementation(() => Promise.resolve(null));

      try {
        await service.deleteAccount("user-1", "password123");
        expect(true).toBe(false); // must not reach
      } catch (e) {
        expect(e).toBeInstanceOf(UnauthorizedException);
        expect((e as UnauthorizedException).message).toBe("Password verification failed.");
      }
    });

    it("throws UnauthorizedException when account has no password field", async () => {
      mockPrisma.account.findFirst.mockImplementation(() =>
        Promise.resolve({ password: null }),
      );

      try {
        await service.deleteAccount("user-1", "password123");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(UnauthorizedException);
        expect((e as UnauthorizedException).message).toBe("Password verification failed.");
      }
    });

    it("throws UnauthorizedException for incorrect password", async () => {
      mockPrisma.account.findFirst.mockImplementation(() =>
        Promise.resolve({ password: "hashed-pw" }),
      );
      mockVerifyPassword.mockImplementation(() => Promise.resolve(false));

      try {
        await service.deleteAccount("user-1", "wrong-password");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(UnauthorizedException);
        expect((e as UnauthorizedException).message).toBe("Password verification failed.");
      }
    });

    it("uses the same generic message for missing account and wrong password (security requirement)", async () => {
      // Case 1: no account
      mockPrisma.account.findFirst.mockImplementation(() => Promise.resolve(null));
      let msg1 = "";
      try {
        await service.deleteAccount("user-1", "any");
      } catch (e) {
        msg1 = (e as UnauthorizedException).message;
      }

      // Case 2: wrong password
      clearAllMocks();
      service = new AccountService(
        mockPrisma as unknown as PrismaService,
        mockStorage as unknown as StorageProvider,
        mockLogger as never,
      );
      mockVerifyPassword.mockImplementation(() => Promise.resolve(false));
      let msg2 = "";
      try {
        await service.deleteAccount("user-1", "wrong");
      } catch (e) {
        msg2 = (e as UnauthorizedException).message;
      }

      expect(msg1).toBe(msg2);
      expect(msg1).toBe("Password verification failed.");
    });

    it("deletes orgs where user is sole owner", async () => {
      // User is owner of org-1 (sole) and member of org-2
      mockPrisma.member.findMany.mockImplementation(() =>
        Promise.resolve([
          { organizationId: "org-1", role: "owner" },
          { organizationId: "org-2", role: "member" },
        ]),
      );
      // No other owners for org-1
      mockPrisma.member.groupBy.mockImplementation(() => Promise.resolve([]));

      await service.deleteAccount("user-1", "correct-password");

      expect(mockPrisma.organization.delete).toHaveBeenCalledWith({
        where: { id: "org-1" },
      });
    });

    it("does not delete orgs where other owners exist", async () => {
      mockPrisma.member.findMany.mockImplementation(() =>
        Promise.resolve([
          { organizationId: "org-1", role: "owner" },
        ]),
      );
      // Another owner exists for org-1
      mockPrisma.member.groupBy.mockImplementation(() =>
        Promise.resolve([{ organizationId: "org-1", _count: 1 }]),
      );

      await service.deleteAccount("user-1", "correct-password");

      expect(mockPrisma.organization.delete).not.toHaveBeenCalled();
    });

    it("anonymizes content in remaining orgs with DELETED_USER_SENTINEL", async () => {
      // User is owner of org-1 (sole owner) and member of org-2 (remaining)
      mockPrisma.member.findMany.mockImplementation(() =>
        Promise.resolve([
          { organizationId: "org-1", role: "owner" },
          { organizationId: "org-2", role: "member" },
        ]),
      );
      // No other owners for org-1
      mockPrisma.member.groupBy.mockImplementation(() => Promise.resolve([]));

      await service.deleteAccount("user-1", "correct-password");

      // projectUpdate.updateMany should set authorId to sentinel for org-2
      expect(mockPrisma.projectUpdate.updateMany).toHaveBeenCalledWith({
        where: { authorId: "user-1", organizationId: { in: ["org-2"] } },
        data: { authorId: "deleted" },
      });

      expect(mockPrisma.projectNote.updateMany).toHaveBeenCalledWith({
        where: { authorId: "user-1", organizationId: { in: ["org-2"] } },
        data: { authorId: "deleted" },
      });

      expect(mockPrisma.file.updateMany).toHaveBeenCalledWith({
        where: { uploadedById: "user-1", organizationId: { in: ["org-2"] } },
        data: { uploadedById: "deleted" },
      });
    });

    it("deletes the user record", async () => {
      await service.deleteAccount("user-1", "correct-password");

      expect(mockPrisma.user.delete).toHaveBeenCalledWith({
        where: { id: "user-1" },
      });
    });

    it("collects and purges file storage keys for deleted orgs", async () => {
      mockPrisma.member.findMany.mockImplementation(() =>
        Promise.resolve([
          { organizationId: "org-1", role: "owner" },
        ]),
      );
      // No other owners => org-1 will be deleted
      mockPrisma.member.groupBy.mockImplementation(() => Promise.resolve([]));

      mockPrisma.file.findMany.mockImplementation(() =>
        Promise.resolve([
          { storageKey: "org-1/proj/file-a.pdf" },
          { storageKey: "org-1/proj/file-b.png" },
        ]),
      );

      await service.deleteAccount("user-1", "correct-password");

      // Storage keys should be queried for the org being deleted, scoped to
      // UPLOAD-type files with a non-null storageKey (link-type files have no
      // storage to purge).
      expect(mockPrisma.file.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: { in: ["org-1"] },
          type: "UPLOAD",
          storageKey: { not: null },
        },
        select: { storageKey: true },
      });

      // storage.delete should be called for each key
      // Give the fire-and-forget Promise.allSettled time to resolve
      await new Promise((r) => setTimeout(r, 10));
      expect(mockStorage.delete).toHaveBeenCalledTimes(2);
    });

    it("does not query file storage when no orgs are being deleted", async () => {
      // User is only a member, not an owner
      mockPrisma.member.findMany.mockImplementation(() =>
        Promise.resolve([
          { organizationId: "org-1", role: "member" },
        ]),
      );

      await service.deleteAccount("user-1", "correct-password");

      // file.findMany for storage keys should NOT be called
      expect(mockPrisma.file.findMany).not.toHaveBeenCalled();
      expect(mockStorage.delete).not.toHaveBeenCalled();
    });

    it("handles non-owner users: no orgs to delete, removes membership and user", async () => {
      mockPrisma.member.findMany.mockImplementation(() =>
        Promise.resolve([
          { organizationId: "org-1", role: "member" },
          { organizationId: "org-2", role: "admin" },
        ]),
      );

      await service.deleteAccount("user-1", "correct-password");

      // Should NOT delete any orgs
      expect(mockPrisma.organization.delete).not.toHaveBeenCalled();

      // Should NOT call groupBy (no owner orgs to check)
      expect(mockPrisma.member.groupBy).not.toHaveBeenCalled();

      // Should anonymize in all orgs (all are "remaining")
      expect(mockPrisma.projectUpdate.updateMany).toHaveBeenCalledWith({
        where: { authorId: "user-1", organizationId: { in: ["org-1", "org-2"] } },
        data: { authorId: "deleted" },
      });

      // Should delete user
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({
        where: { id: "user-1" },
      });
    });

    it("runs org deletion and user deletion within a transaction", async () => {
      await service.deleteAccount("user-1", "correct-password");

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("cleans up user-level data (clientProfile, invitation) before deleting user", async () => {
      await service.deleteAccount("user-1", "correct-password");

      expect(mockPrisma.clientProfile.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
      });
      expect(mockPrisma.invitation.deleteMany).toHaveBeenCalledWith({
        where: { inviterId: "user-1" },
      });
    });
  });
});
