import { describe, expect, it, mock, beforeEach } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { BrandingService } from "./branding.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { ConfigService } from "@nestjs/config";

const mockPrisma = {
  branding: {
    findUnique: mock(() => Promise.resolve(null)),
    upsert: mock((args: { create: Record<string, unknown>; update: Record<string, unknown> }) =>
      Promise.resolve({ id: "b1", ...args.create, ...args.update }),
    ),
  },
  organization: {
    findUnique: mock(() => Promise.resolve(null)),
    findFirst: mock(() => Promise.resolve(null)),
    count: mock(() => Promise.resolve(0)),
  },
};

const mockConfig = {
  get: mock((_key: string, fallback?: string) => fallback ?? "http://localhost:3001"),
} as unknown as ConfigService;

describe("BrandingService", () => {
  let service: BrandingService;

  beforeEach(() => {
    service = new BrandingService(mockPrisma as unknown as PrismaService, mockConfig);
  });

  it("findByOrg returns defaults when not found", async () => {
    mockPrisma.branding.findUnique.mockReturnValue(Promise.resolve(null));

    const result = await service.findByOrg("org-1");
    expect(result).toEqual({
      organizationId: "org-1",
      primaryColor: null,
      accentColor: null,
      logoKey: null,
      logoUrl: null,
      hideLogo: false,
    });
  });

  it("findByOrg returns branding", async () => {
    const branding = {
      id: "b1",
      organizationId: "org-1",
      primaryColor: "#006b68",
      accentColor: "#ff6b5c",
    };
    mockPrisma.branding.findUnique.mockReturnValue(
      Promise.resolve(branding),
    );

    const result = await service.findByOrg("org-1");
    expect(result).toEqual(branding);
  });

  it("update upserts branding", async () => {
    await service.update("org-1", { primaryColor: "#000000" });

    expect(mockPrisma.branding.upsert).toHaveBeenCalled();
  });

  describe("findBySlug", () => {
    it("throws NotFoundException for unknown slug", async () => {
      mockPrisma.organization.findUnique.mockReturnValue(Promise.resolve(null));
      await expect(service.findBySlug("nonexistent")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns branding with logoSrc from logoKey", async () => {
      mockPrisma.organization.findUnique.mockReturnValue(
        Promise.resolve({ id: "org-1", name: "Acme Corp", slug: "acme" }),
      );
      mockPrisma.branding.findUnique.mockReturnValue(
        Promise.resolve({
          organizationId: "org-1",
          primaryColor: "#ff0000",
          accentColor: null,
          logoKey: "branding/org-1/logo.png",
          logoUrl: null,
          hideLogo: false,
        }),
      );

      const result = await service.findBySlug("acme");
      expect(result.orgName).toBe("Acme Corp");
      expect(result.logoSrc).toContain("/api/branding/logo/org-1");
      expect(result.primaryColor).toBe("#ff0000");
    });

    it("returns null logoSrc when no logo configured", async () => {
      mockPrisma.organization.findUnique.mockReturnValue(
        Promise.resolve({ id: "org-2", name: "No Logo Corp", slug: "nologocorp" }),
      );
      mockPrisma.branding.findUnique.mockReturnValue(Promise.resolve(null));

      const result = await service.findBySlug("nologocorp");
      expect(result.logoSrc).toBeNull();
    });
  });

  describe("findByDomain", () => {
    it("returns null when domain not registered", async () => {
      mockPrisma.organization.findFirst.mockReturnValue(Promise.resolve(null));
      const result = await service.findByDomain("unknown.example.com");
      expect(result).toBeNull();
    });

    it("returns branding for a registered custom domain", async () => {
      mockPrisma.organization.findFirst.mockReturnValue(
        Promise.resolve({ id: "org-1", name: "Acme Corp" }),
      );
      mockPrisma.branding.findUnique.mockReturnValue(
        Promise.resolve({
          organizationId: "org-1",
          primaryColor: "#ff0000",
          accentColor: null,
          logoKey: "branding/org-1/logo.png",
          logoUrl: null,
          hideLogo: false,
        }),
      );

      const result = await service.findByDomain("portal.acme.com");
      expect(result).not.toBeNull();
      expect(result!.orgName).toBe("Acme Corp");
      expect(result!.logoSrc).toContain("/api/branding/logo/org-1");
    });

    it("returns null logoSrc when org has no logo", async () => {
      mockPrisma.organization.findFirst.mockReturnValue(
        Promise.resolve({ id: "org-2", name: "No Logo" }),
      );
      mockPrisma.branding.findUnique.mockReturnValue(Promise.resolve(null));

      const result = await service.findByDomain("portal.nologocorp.com");
      expect(result!.logoSrc).toBeNull();
    });
  });

  describe("findInstanceBranding", () => {
    it("returns null when multiple orgs exist (hosted)", async () => {
      mockPrisma.organization.count.mockReturnValue(Promise.resolve(2));
      const result = await service.findInstanceBranding();
      expect(result).toBeNull();
    });

    it("returns null when single org has no logo", async () => {
      mockPrisma.organization.count.mockReturnValue(Promise.resolve(1));
      mockPrisma.organization.findFirst.mockReturnValue(
        Promise.resolve({ id: "org-1", name: "Solo Corp" }),
      );
      mockPrisma.branding.findUnique.mockReturnValue(Promise.resolve(null));

      const result = await service.findInstanceBranding();
      expect(result).toBeNull();
    });

    it("returns branding when single org has a logo", async () => {
      mockPrisma.organization.count.mockReturnValue(Promise.resolve(1));
      mockPrisma.organization.findFirst.mockReturnValue(
        Promise.resolve({ id: "org-1", name: "Solo Corp" }),
      );
      mockPrisma.branding.findUnique.mockReturnValue(
        Promise.resolve({
          organizationId: "org-1",
          primaryColor: "#ff0000",
          accentColor: null,
          logoKey: "branding/org-1/logo.png",
          logoUrl: null,
          hideLogo: false,
        }),
      );

      const result = await service.findInstanceBranding();
      expect(result).not.toBeNull();
      expect(result!.orgName).toBe("Solo Corp");
      expect(result!.logoSrc).toContain("/api/branding/logo/org-1");
    });
  });
});
