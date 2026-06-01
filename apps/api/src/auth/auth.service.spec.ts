import { describe, expect, it, mock, beforeEach } from "bun:test";
import { InternalServerErrorException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service";
import type { MailService } from "../mail/mail.service";
import type { BillingService } from "../billing/billing.service";

const mockConfig = {
  get: mock((key: string, fallback?: string) => {
    if (key === "WEB_URL") return "http://localhost:3000";
    if (key === "API_URL") return "http://localhost:3001";
    return fallback;
  }),
  getOrThrow: mock((key: string) => {
    if (key === "BETTER_AUTH_SECRET") return "x".repeat(32);
    throw new Error(`Missing ${key}`);
  }),
};

const mockPrisma = {
  member: {
    findFirst: mock(() => Promise.resolve(null)),
  },
  user: {
    findUnique: mock(() => Promise.resolve(null)),
  },
};

const mockMail = { send: mock(() => Promise.resolve()) };
const mockBilling = { initializeFreePlan: mock(() => Promise.resolve()) };

function makeService(): AuthService {
  return new AuthService(
    mockConfig as unknown as ConfigService,
    mockPrisma as unknown as PrismaService,
    mockMail as unknown as MailService,
    mockBilling as unknown as BillingService,
  );
}

describe("AuthService", () => {
  let service: AuthService;

  beforeEach(() => {
    service = makeService();
    mockPrisma.member.findFirst.mockClear();
    mockPrisma.user.findUnique.mockClear();
  });

  describe("getPrimaryOrgForUserId", () => {
    it("returns the most recent membership organizationId", async () => {
      mockPrisma.member.findFirst.mockReturnValueOnce(
        Promise.resolve({ organizationId: "org-123" }),
      );

      const result = await service.getPrimaryOrgForUserId("user-1");

      expect(result).toBe("org-123");
      const call = mockPrisma.member.findFirst.mock.calls[0][0] as {
        where: { userId: string };
        orderBy: { createdAt: string };
      };
      expect(call.where).toEqual({ userId: "user-1" });
      expect(call.orderBy).toEqual({ createdAt: "desc" });
    });

    it("returns undefined when the user has no memberships", async () => {
      mockPrisma.member.findFirst.mockReturnValueOnce(Promise.resolve(null));

      const result = await service.getPrimaryOrgForUserId("user-orphan");

      expect(result).toBeUndefined();
    });

    it("returns undefined and swallows errors when the query fails", async () => {
      mockPrisma.member.findFirst.mockReturnValueOnce(
        Promise.reject(new Error("db down")),
      );

      const result = await service.getPrimaryOrgForUserId("user-1");

      expect(result).toBeUndefined();
    });
  });

  describe("getPrimaryOrgForEmail", () => {
    it("resolves orgId via a single member query joined on user.email", async () => {
      mockPrisma.member.findFirst.mockReturnValueOnce(
        Promise.resolve({ organizationId: "org-456" }),
      );

      const result = await service.getPrimaryOrgForEmail("alice@example.com");

      expect(result).toBe("org-456");
      const call = mockPrisma.member.findFirst.mock.calls[0][0] as {
        where: { user: { email: string } };
      };
      expect(call.where).toEqual({ user: { email: "alice@example.com" } });
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("returns undefined when no membership matches the email", async () => {
      mockPrisma.member.findFirst.mockReturnValueOnce(Promise.resolve(null));

      const result = await service.getPrimaryOrgForEmail("ghost@example.com");

      expect(result).toBeUndefined();
    });

    it("returns undefined and swallows errors when the query fails", async () => {
      mockPrisma.member.findFirst.mockReturnValueOnce(
        Promise.reject(new Error("db down")),
      );

      const result = await service.getPrimaryOrgForEmail("alice@example.com");

      expect(result).toBeUndefined();
    });
  });

  describe("generateResetLink", () => {
    // generateResetLink was migrated from Better Auth (ALS-captured reset URL)
    // to WorkOS userManagement.createPasswordReset(). These tests track the
    // current WorkOS implementation.
    function mockCreatePasswordReset(
      impl: (args: { email: string }) => Promise<{ passwordResetUrl?: string }>,
    ) {
      const fn = mock(impl);
      // Inject a fake WorkOS client into the lazy getter's backing field so we
      // never construct the real SDK (which needs WORKOS_API_KEY).
      (
        service as unknown as {
          workosClient: { userManagement: { createPasswordReset: typeof fn } };
        }
      ).workosClient = { userManagement: { createPasswordReset: fn } };
      return fn;
    }

    it("returns the WorkOS password reset URL with emailSent=true", async () => {
      const expectedUrl = "https://auth.workos.com/reset/token-abc";
      const createPasswordReset = mockCreatePasswordReset(async () => ({
        passwordResetUrl: expectedUrl,
      }));

      const result = await service.generateResetLink("alice@example.com");

      expect(result).toEqual({
        url: expectedUrl,
        emailSent: true,
        emailViaOrgConfig: false,
      });
      expect(createPasswordReset).toHaveBeenCalledTimes(1);
      expect(createPasswordReset.mock.calls[0][0]).toEqual({
        email: "alice@example.com",
      });
    });

    it("throws InternalServerErrorException when WorkOS returns no URL", async () => {
      mockCreatePasswordReset(async () => ({ passwordResetUrl: undefined }));

      await expect(
        service.generateResetLink("ghost@example.com"),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it("keeps reset URLs isolated across concurrent calls", async () => {
      mockCreatePasswordReset(async ({ email }) => {
        await new Promise((r) => setTimeout(r, 5));
        return { passwordResetUrl: `https://auth.workos.com/reset/${email}` };
      });

      const [a, b] = await Promise.all([
        service.generateResetLink("a@example.com"),
        service.generateResetLink("b@example.com"),
      ]);

      expect(a.url).toBe("https://auth.workos.com/reset/a@example.com");
      expect(b.url).toBe("https://auth.workos.com/reset/b@example.com");
    });
  });
});
