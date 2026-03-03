import { describe, expect, it, mock, beforeEach } from "bun:test";
import { ClientsService } from "./clients.service";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";

interface PrismaArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Mock Prisma client
// ---------------------------------------------------------------------------
const mockPrisma = {
  member: {
    findFirst: mock(() => Promise.resolve(null)),
    count: mock(() => Promise.resolve(0)),
    delete: mock((args: PrismaArgs) => Promise.resolve({ id: args.where?.id })),
    update: mock((args: PrismaArgs) =>
      Promise.resolve({ id: args.where?.id, ...args.data }),
    ),
  },
  project: {
    findMany: mock(() => Promise.resolve([])),
  },
  projectClient: {
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  $transaction: mock((ops: Promise<unknown>[]) => Promise.all(ops)),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeMember(overrides: Partial<{
  id: string;
  userId: string;
  organizationId: string;
  role: string;
}> = {}) {
  return {
    id: "member-1",
    userId: "user-target",
    organizationId: "org-1",
    role: "member",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("ClientsService", () => {
  let service: ClientsService;

  beforeEach(() => {
    service = new ClientsService(mockPrisma as unknown as PrismaService);
    // Reset all mocks before each test so state does not leak
    mockPrisma.member.findFirst.mockClear();
    mockPrisma.member.count.mockClear();
    mockPrisma.member.delete.mockClear();
    mockPrisma.member.update.mockClear();
    mockPrisma.project.findMany.mockClear();
    mockPrisma.projectClient.deleteMany.mockClear();
    mockPrisma.$transaction.mockClear();
  });

  // -------------------------------------------------------------------------
  // removeMember
  // -------------------------------------------------------------------------
  describe("removeMember", () => {
    it("throws NotFoundException when member does not exist", async () => {
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.removeMember("nonexistent-member", "org-1", "user-requester", "owner");
        expect(true).toBe(false); // must not reach
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect((e as NotFoundException).message).toBe("Member not found");
      }
    });

    it("throws BadRequestException when requesting user tries to remove themselves", async () => {
      const member = makeMember({ id: "member-1", userId: "user-self", role: "admin" });
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(member));

      try {
        // requestingUserId matches member.userId
        await service.removeMember("member-1", "org-1", "user-self", "owner");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toBe("Cannot remove yourself");
      }
    });

    it("throws BadRequestException when an admin tries to remove an owner", async () => {
      const ownerMember = makeMember({ id: "member-owner", userId: "user-owner", role: "owner" });
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(ownerMember));

      try {
        await service.removeMember("member-owner", "org-1", "user-admin", "admin");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toBe("Only owners can remove other owners");
      }
    });

    it("allows an owner to remove another owner", async () => {
      const ownerMember = makeMember({ id: "member-owner2", userId: "user-owner2", role: "owner" });
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(ownerMember));
      mockPrisma.project.findMany.mockReturnValue(
        Promise.resolve([{ id: "proj-1" }, { id: "proj-2" }]),
      );

      // Should not throw
      await service.removeMember("member-owner2", "org-1", "user-requesting-owner", "owner");

      // Confirm the transaction was called
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it("scopes ProjectClient deletion to only the current org's projects", async () => {
      const member = makeMember({ id: "member-1", userId: "user-target", role: "member" });
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(member));
      mockPrisma.project.findMany.mockReturnValue(
        Promise.resolve([{ id: "proj-a" }, { id: "proj-b" }]),
      );

      await service.removeMember("member-1", "org-1", "user-requester", "admin");

      // project.findMany must be called with the correct org scope
      expect(mockPrisma.project.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1" },
        select: { id: true },
      });

      // The deleteMany must restrict to the org's project IDs — not all projects globally
      expect(mockPrisma.projectClient.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-target", projectId: { in: ["proj-a", "proj-b"] } },
      });
    });

    it("successfully removes a regular member and runs both ops in a transaction", async () => {
      const member = makeMember({ id: "member-1", userId: "user-target", role: "member" });
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(member));
      mockPrisma.project.findMany.mockReturnValue(
        Promise.resolve([{ id: "proj-1" }]),
      );

      await service.removeMember("member-1", "org-1", "user-requester", "admin");

      // Both the projectClient cleanup and member deletion must be wrapped in a transaction
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.member.delete).toHaveBeenCalledWith({
        where: { id: "member-1" },
      });
    });

    it("handles org with no projects (empty projectIds array)", async () => {
      const member = makeMember({ id: "member-1", userId: "user-target", role: "member" });
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(member));
      // No projects in this org
      mockPrisma.project.findMany.mockReturnValue(Promise.resolve([]));

      await service.removeMember("member-1", "org-1", "user-requester", "admin");

      expect(mockPrisma.projectClient.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-target", projectId: { in: [] } },
      });
    });
  });

  // -------------------------------------------------------------------------
  // changeRole
  // -------------------------------------------------------------------------
  describe("changeRole", () => {
    it("throws NotFoundException when member does not exist", async () => {
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.changeRole("nonexistent-member", "admin", "org-1", "user-requester");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect((e as NotFoundException).message).toBe("Member not found");
      }
    });

    it("throws BadRequestException when a user tries to change their own role", async () => {
      const member = makeMember({ id: "member-1", userId: "user-self", role: "admin" });
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(member));

      try {
        await service.changeRole("member-1", "member", "org-1", "user-self");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toBe("Cannot change your own role");
      }
    });

    it("throws BadRequestException when demoting the last owner", async () => {
      const owner = makeMember({ id: "member-owner", userId: "user-owner", role: "owner" });
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(owner));
      // Only one owner in the org
      mockPrisma.member.count.mockReturnValue(Promise.resolve(1));

      try {
        await service.changeRole("member-owner", "admin", "org-1", "user-requester");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toBe("Cannot demote the last owner");
      }
    });

    it("allows demoting an owner when multiple owners exist", async () => {
      const owner = makeMember({ id: "member-owner", userId: "user-owner", role: "owner" });
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(owner));
      // Two owners exist — safe to demote
      mockPrisma.member.count.mockReturnValue(Promise.resolve(2));
      mockPrisma.member.update.mockReturnValue(
        Promise.resolve({ id: "member-owner", role: "admin" }),
      );

      const result = await service.changeRole("member-owner", "admin", "org-1", "user-requester");

      expect(result.role).toBe("admin");
      expect(mockPrisma.member.update).toHaveBeenCalledWith({
        where: { id: "member-owner" },
        data: { role: "admin" },
      });
    });

    it("throws BadRequestException for an invalid role value", async () => {
      const member = makeMember({ id: "member-1", userId: "user-target", role: "member" });
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(member));

      try {
        await service.changeRole("member-1", "superuser", "org-1", "user-requester");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toBe("Invalid role");
      }
    });

    it("rejects an empty-string role", async () => {
      const member = makeMember({ id: "member-1", userId: "user-target", role: "member" });
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(member));

      try {
        await service.changeRole("member-1", "", "org-1", "user-requester");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toBe("Invalid role");
      }
    });

    it("successfully promotes a member to admin", async () => {
      const member = makeMember({ id: "member-1", userId: "user-target", role: "member" });
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(member));
      mockPrisma.member.update.mockReturnValue(
        Promise.resolve({ id: "member-1", role: "admin" }),
      );

      const result = await service.changeRole("member-1", "admin", "org-1", "user-requester");

      expect(result.role).toBe("admin");
      expect(mockPrisma.member.update).toHaveBeenCalledWith({
        where: { id: "member-1" },
        data: { role: "admin" },
      });
    });

    it("successfully promotes a member to owner", async () => {
      const member = makeMember({ id: "member-1", userId: "user-target", role: "member" });
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(member));
      mockPrisma.member.update.mockReturnValue(
        Promise.resolve({ id: "member-1", role: "owner" }),
      );

      const result = await service.changeRole("member-1", "owner", "org-1", "user-requester");

      expect(result.role).toBe("owner");
    });

    it("does not check owner count when the target member is not an owner", async () => {
      const member = makeMember({ id: "member-1", userId: "user-target", role: "member" });
      mockPrisma.member.findFirst.mockReturnValue(Promise.resolve(member));
      mockPrisma.member.update.mockReturnValue(
        Promise.resolve({ id: "member-1", role: "admin" }),
      );

      await service.changeRole("member-1", "admin", "org-1", "user-requester");

      // count should NOT have been called — only needed when demoting an owner
      expect(mockPrisma.member.count).not.toHaveBeenCalled();
    });
  });
});
