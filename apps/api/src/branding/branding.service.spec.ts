import { describe, expect, it, mock, beforeEach } from "bun:test";
import { BrandingService } from "./branding.service";
import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";

const mockPrisma = {
  branding: {
    findUnique: mock(() => Promise.resolve(null)),
    upsert: mock((args: { create: Record<string, unknown>; update: Record<string, unknown> }) =>
      Promise.resolve({ id: "b1", ...args.create, ...args.update }),
    ),
  },
};

describe("BrandingService", () => {
  let service: BrandingService;

  beforeEach(() => {
    service = new BrandingService(mockPrisma as unknown as PrismaService);
  });

  it("findByOrg throws when not found", async () => {
    mockPrisma.branding.findUnique.mockReturnValue(Promise.resolve(null));

    try {
      await service.findByOrg("org-1");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundException);
    }
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
});
