import { describe, expect, it } from "bun:test";
import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service";
import { DemoService } from "./demo.service";

const ENV = {
  DEMO_MODE: "true",
  DEMO_ORG_SLUG: "demo",
  DEMO_OWNER_EMAIL: "owner@demo.invalid",
  DEMO_CLIENT_EMAIL: "client@demo.invalid",
};

function config(overrides: Record<string, string | undefined> = {}): ConfigService {
  const values: Record<string, string | undefined> = { ...ENV, ...overrides };
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

function prisma(org: { id: string; slug: string } | null = { id: "org_1", slug: "demo" }): {
  service: PrismaService;
  calls: () => number;
} {
  let calls = 0;
  const service = {
    organization: {
      findUnique: async () => {
        calls += 1;
        return org;
      },
    },
  } as unknown as PrismaService;
  return { service, calls: () => calls };
}

describe("DemoService", () => {
  it("is disabled unless DEMO_MODE is exactly 'true'", () => {
    expect(new DemoService(config({ DEMO_MODE: undefined }), prisma().service).enabled).toBe(false);
    expect(new DemoService(config({ DEMO_MODE: "1" }), prisma().service).enabled).toBe(false);
    expect(new DemoService(config(), prisma().service).enabled).toBe(true);
  });

  it("isDemoAddress matches the configured owner and client, case-insensitively", () => {
    const service = new DemoService(config(), prisma().service);
    expect(service.isDemoAddress("Owner@Demo.Invalid")).toBe(true);
    expect(service.isDemoAddress("client@demo.invalid")).toBe(true);
    expect(service.isDemoAddress("edgar@vibralabs.co")).toBe(false);
  });

  it("isDemoAddress is false for every address when disabled", () => {
    const service = new DemoService(config({ DEMO_MODE: undefined }), prisma().service);
    expect(service.isDemoAddress("owner@demo.invalid")).toBe(false);
  });

  it("exposes no addresses or slug when disabled", () => {
    const service = new DemoService(config({ DEMO_MODE: undefined }), prisma().service);
    expect(service.orgSlug).toBeNull();
    expect(service.ownerEmail).toBeNull();
    expect(service.clientEmail).toBeNull();
  });

  it("isDemoOrg is false when DEMO_ORG_SLUG is unset", async () => {
    const service = new DemoService(config({ DEMO_ORG_SLUG: undefined }), prisma().service);
    expect(await service.isDemoOrg("org_1")).toBe(false);
  });

  it("isDemoOrg is false for an undefined organization", async () => {
    const service = new DemoService(config(), prisma().service);
    expect(await service.isDemoOrg(undefined)).toBe(false);
  });

  it("isDemoOrg is true only for the configured org", async () => {
    const service = new DemoService(config(), prisma().service);
    expect(await service.isDemoOrg("org_1")).toBe(true);
    expect(await service.isDemoOrg("org_other")).toBe(false);
  });

  it("demoOrgId resolves the org by slug and memoises the lookup", async () => {
    const db = prisma();
    const service = new DemoService(config(), db.service);
    expect(await service.demoOrgId()).toBe("org_1");
    expect(await service.demoOrgId()).toBe("org_1");
    expect(db.calls()).toBe(1);
  });

  it("demoOrgId does not memoise a miss, so it is found after seeding", async () => {
    const db = prisma(null);
    const service = new DemoService(config(), db.service);
    expect(await service.demoOrgId()).toBeNull();
    expect(await service.demoOrgId()).toBeNull();
    expect(db.calls()).toBe(2);
  });

  it("records demo activity so a reset can skip a visitor mid-click", () => {
    const service = new DemoService(config(), prisma().service);
    expect(service.lastActivityAt).toBeNull();
    service.touch();
    expect(service.lastActivityAt).toBeInstanceOf(Date);
  });
});
