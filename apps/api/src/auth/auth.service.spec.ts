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
    it("returns the URL and emailSent captured from the sendResetPassword callback context", async () => {
      const expectedUrl =
        "http://localhost:3001/api/auth/reset-password/token-abc?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Freset-password";

      const requestPasswordReset = mock(async () => {
        const store = (
          service as unknown as {
            adminResetStorage: {
              getStore: () => {
                capturedUrl: string | null;
                emailSent: boolean;
                emailViaOrgConfig: boolean;
              } | undefined;
            };
          }
        ).adminResetStorage.getStore();
        if (store) {
          store.capturedUrl = expectedUrl;
          store.emailSent = true;
          store.emailViaOrgConfig = true;
        }
      });
      (service.auth as unknown as {
        api: { requestPasswordReset: typeof requestPasswordReset };
      }).api.requestPasswordReset = requestPasswordReset;

      const result = await service.generateResetLink("alice@example.com");

      expect(result).toEqual({
        url: expectedUrl,
        emailSent: true,
        emailViaOrgConfig: true,
      });
      expect(requestPasswordReset).toHaveBeenCalledTimes(1);
      const callArg = requestPasswordReset.mock.calls[0][0] as {
        body: { email: string; redirectTo: string };
      };
      expect(callArg.body.email).toBe("alice@example.com");
      expect(callArg.body.redirectTo).toBe("http://localhost:3000/reset-password");
    });

    it("returns emailSent=false when no provider sent the email", async () => {
      const requestPasswordReset = mock(async () => {
        const store = (
          service as unknown as {
            adminResetStorage: {
              getStore: () => {
                capturedUrl: string | null;
                emailSent: boolean;
                emailViaOrgConfig: boolean;
              } | undefined;
            };
          }
        ).adminResetStorage.getStore();
        if (store) {
          store.capturedUrl = "https://example.test/reset/abc";
          // emailSent and emailViaOrgConfig stay false
        }
      });
      (service.auth as unknown as {
        api: { requestPasswordReset: typeof requestPasswordReset };
      }).api.requestPasswordReset = requestPasswordReset;

      const result = await service.generateResetLink("alice@example.com");

      expect(result.emailSent).toBe(false);
      expect(result.emailViaOrgConfig).toBe(false);
    });

    it("throws InternalServerErrorException when no URL was captured", async () => {
      (service.auth as unknown as {
        api: { requestPasswordReset: () => Promise<void> };
      }).api.requestPasswordReset = mock(async () => {
        // intentionally do not populate the ALS context
      });

      await expect(service.generateResetLink("ghost@example.com")).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    it("isolates ALS contexts so concurrent generates do not bleed URLs", async () => {
      let call = 0;
      (service.auth as unknown as {
        api: { requestPasswordReset: (args: { body: { email: string } }) => Promise<void> };
      }).api.requestPasswordReset = mock(async ({ body }) => {
        const store = (
          service as unknown as {
            adminResetStorage: {
              getStore: () => {
                capturedUrl: string | null;
                emailSent: boolean;
                emailViaOrgConfig: boolean;
              } | undefined;
            };
          }
        ).adminResetStorage.getStore();
        await new Promise((r) => setTimeout(r, ++call * 5));
        if (store) {
          store.capturedUrl = `https://example.test/reset/${body.email}`;
          store.emailSent = true;
          store.emailViaOrgConfig = true;
        }
      });

      const [a, b] = await Promise.all([
        service.generateResetLink("a@example.com"),
        service.generateResetLink("b@example.com"),
      ]);

      expect(a.url).toBe("https://example.test/reset/a@example.com");
      expect(b.url).toBe("https://example.test/reset/b@example.com");
    });
  });
});
