import { describe, expect, it } from "bun:test";
import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service";
import { DemoService } from "./demo.service";
import { demoEnvValue } from "./demo-config";

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

  it("isDemoOrg resolves against the default slug when DEMO_ORG_SLUG is unset", async () => {
    // DEMO_MODE=true is the whole configuration: the slug defaults to the one
    // the seed writes, so turning the demo on cannot leave it half-enabled.
    const service = new DemoService(config({ DEMO_ORG_SLUG: undefined }), prisma().service);
    expect(await service.isDemoOrg("org_1")).toBe(true);
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

  it("lowercases the configured addresses, since the seed stores them lowercased", () => {
    // Otherwise DEMO_OWNER_EMAIL="Owner@demo.invalid" seeds owner@demo.invalid
    // and signs in Owner@demo.invalid: a miss, a second orgless user, and a
    // demo that looks broken for a plausible typo.
    const service = new DemoService(
      config({ DEMO_OWNER_EMAIL: "Owner@Demo.Invalid" }),
      prisma().service,
    );
    expect(service.ownerEmail).toBe("owner@demo.invalid");
  });

  it("defaults the slug and both addresses to what the seed writes", () => {
    // The seed already defaults all three (scripts/seed-demo.ts, demo-seed.ts).
    // The API refusing to do the same is what made DEMO_MODE=true alone look
    // like a broken demo: a silent 404, three variables away from working.
    const service = new DemoService(
      config({
        DEMO_ORG_SLUG: undefined,
        DEMO_OWNER_EMAIL: undefined,
        DEMO_CLIENT_EMAIL: undefined,
      }),
      prisma().service,
    );
    expect(service.orgSlug).toBe("demo");
    expect(service.ownerEmail).toBe("owner@demo.invalid");
    expect(service.clientEmail).toBe("client@demo.invalid");
  });

  it("refuses to start when a configured demo address is not @demo.invalid", () => {
    // Anonymous sign-in: an address pointing at a real administrator would let
    // anyone in as them with no password. Unset is fine and defaults; set and
    // wrong must stop the process, naming the variable, rather than return null
    // and serve a 404 that looks exactly like demo mode being switched off.
    expect(
      () => new DemoService(config({ DEMO_OWNER_EMAIL: "edgar@vibralabs.co" }), prisma().service),
    ).toThrow(/DEMO_OWNER_EMAIL/);
    expect(
      () => new DemoService(config({ DEMO_CLIENT_EMAIL: "someone@gmail.com" }), prisma().service),
    ).toThrow(/DEMO_CLIENT_EMAIL/);
  });

  it("ignores a stray bad demo address while demo mode is off", () => {
    // An ordinary install with a leftover variable must boot, not crash.
    const service = new DemoService(
      config({ DEMO_MODE: undefined, DEMO_OWNER_EMAIL: "edgar@vibralabs.co" }),
      prisma().service,
    );
    expect(service.enabled).toBe(false);
    expect(service.ownerEmail).toBeNull();
  });

  it("treats a whitespace-only slug or address as unset", () => {
    const service = new DemoService(
      config({ DEMO_ORG_SLUG: "   ", DEMO_OWNER_EMAIL: "  ", DEMO_CLIENT_EMAIL: "\t" }),
      prisma().service,
    );
    expect(service.orgSlug).toBe("demo");
    expect(service.ownerEmail).toBe("owner@demo.invalid");
    expect(service.clientEmail).toBe("client@demo.invalid");
  });

  it("trims a configured slug", () => {
    const service = new DemoService(config({ DEMO_ORG_SLUG: "  northwind  " }), prisma().service);
    expect(service.orgSlug).toBe("northwind");
  });

  it("is disabled for DEMO_MODE values that merely look true", () => {
    for (const value of ["TRUE", "True", "yes", "on", " true"]) {
      expect(new DemoService(config({ DEMO_MODE: value }), prisma().service).enabled).toBe(false);
    }
  });

  it("refuses addresses that only resemble the demo domain", () => {
    // The domain is matched as an exact tail, so a lookalike that merely
    // contains it, or sits one label below it, is not a demo address. Each of
    // these would be a real deliverable mailbox somebody could own.
    for (const bad of [
      "owner@demo.invalid.com",
      "owner@sub.demo.invalid",
      "owner@notdemo.invalid",
      "demo.invalid",
    ]) {
      expect(() => new DemoService(config({ DEMO_OWNER_EMAIL: bad }), prisma().service)).toThrow(
        /DEMO_OWNER_EMAIL/,
      );
    }
  });

  it("accepts an address whose tail is the demo domain even with an earlier @", () => {
    // Pinning current behaviour rather than endorsing it: endsWith is what
    // decides, so this passes. It is not a way in -- @demo.invalid is an
    // undeliverable reserved TLD and entry additionally requires the account
    // to already exist -- but if the rule is ever tightened, this test is the
    // one that should change, deliberately.
    const service = new DemoService(
      config({ DEMO_OWNER_EMAIL: "a@evil.com@demo.invalid" }),
      prisma().service,
    );
    expect(service.ownerEmail).toBe("a@evil.com@demo.invalid");
  });

  it("treats an empty-string variable as unset, which `??` did not", () => {
    // An env var declared with no value in Docker or Coolify arrives as "".
    // The seed used `??`, so it wrote a workspace whose slug was "" while the
    // API resolved "demo" -- the fence then matched nothing and every reset
    // collided on User.email forever.
    const service = new DemoService(
      config({ DEMO_ORG_SLUG: "", DEMO_OWNER_EMAIL: "", DEMO_CLIENT_EMAIL: "" }),
      prisma().service,
    );
    expect(service.orgSlug).toBe("demo");
    expect(service.ownerEmail).toBe("owner@demo.invalid");
    expect(service.clientEmail).toBe("client@demo.invalid");
  });
});

describe("demoEnvValue", () => {
  it("reports a value only when one is really there", () => {
    expect(demoEnvValue(undefined)).toBeUndefined();
    expect(demoEnvValue("")).toBeUndefined();
    expect(demoEnvValue("   ")).toBeUndefined();
    expect(demoEnvValue("\t\n")).toBeUndefined();
  });

  it("trims what it returns, so both sides agree on the value", () => {
    expect(demoEnvValue(" owner@demo.invalid ")).toBe("owner@demo.invalid");
    expect(demoEnvValue("northwind")).toBe("northwind");
  });
});
