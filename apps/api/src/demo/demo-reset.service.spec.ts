/**
 * The reset deletes a whole workspace on a timer, so the test that matters
 * most is the one proving it refuses to run when it cannot confirm the target
 * is the demo — the same contract as test/integration/guard.ts refusing a
 * database whose name does not end in _test.
 */
import { describe, expect, it, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { DemoResetService } from "./demo-reset.service";
import type { DemoService } from "./demo.service";
import type { PrismaService } from "../prisma/prisma.service";

const SLUG = "demo";

function build(options: {
  enabled?: boolean;
  slug?: string | null;
  storedSlug?: string | null;
  lastActivityAt?: Date | null;
  ownerEmail?: string | null;
} = {}) {
  const enabled: boolean = options.enabled ?? true;
  const slug: string | null = options.slug === undefined ? SLUG : options.slug;
  const storedSlug: string | null =
    options.storedSlug === undefined ? slug : options.storedSlug;

  const demo = {
    enabled,
    orgSlug: slug,
    ownerEmail: "owner@demo.invalid",
    clientEmail: "client@demo.invalid",
    lastActivityAt: options.lastActivityAt ?? null,
    touch: mock(() => {}),
  };
  const ownerEmail: string | null =
    options.ownerEmail === undefined ? "owner@demo.invalid" : options.ownerEmail;
  const prisma = {
    organization: {
      findUnique: mock(() =>
        Promise.resolve(
          storedSlug === null
            ? null
            : {
                id: "org-1",
                slug: storedSlug,
                members: ownerEmail === null ? [] : [{ user: { email: ownerEmail } }],
              },
        ),
      ),
    },
  };
  const seeder = mock(() => Promise.resolve({ organizationId: "org-1" }));

  return {
    demo,
    prisma,
    seeder,
    service: new DemoResetService(
      prisma as unknown as PrismaService,
      demo as unknown as DemoService,
      seeder as never,
    ),
  };
}

describe("DemoResetService", () => {
  it("throws when demo mode is off", async () => {
    const { service, seeder } = build({ enabled: false });

    await expect(service.reset()).rejects.toBeInstanceOf(NotFoundException);
    expect(seeder).not.toHaveBeenCalled();
  });

  it("throws when DEMO_ORG_SLUG is unset", async () => {
    const { service, seeder } = build({ slug: null });

    await expect(service.reset()).rejects.toThrow();
    expect(seeder).not.toHaveBeenCalled();
  });

  it("throws before seeding when the target's owner is not a demo account", async () => {
    // The real misconfiguration is DEMO_ORG_SLUG pointing at a live workspace.
    // Checking the slug cannot catch that — the row was looked up BY slug — so
    // the assertion has to be a property the seed guarantees and a real
    // workspace cannot have: an owner on @demo.invalid.
    const { service, seeder } = build({ ownerEmail: "edgar@vibralabs.co" });

    await expect(service.reset()).rejects.toThrow(/demo/i);
    expect(seeder).not.toHaveBeenCalled();
  });

  it("throws when the target workspace has no owner to vouch for it", async () => {
    const { service, seeder } = build({ ownerEmail: null });

    await expect(service.reset()).rejects.toThrow(/demo/i);
    expect(seeder).not.toHaveBeenCalled();
  });

  it("reseeds when the demo org is confirmed", async () => {
    const { service, seeder } = build();

    expect(await service.reset()).toEqual({ reset: true });
    expect(seeder).toHaveBeenCalled();
  });

  it("seeds a missing demo org rather than refusing, so first boot works", async () => {
    const { service, seeder } = build({ storedSlug: null });

    expect(await service.reset()).toEqual({ reset: true });
    expect(seeder).toHaveBeenCalled();
  });

  it("skips when there was demo activity in the last five minutes", async () => {
    const { service, seeder } = build({ lastActivityAt: new Date(Date.now() - 60_000) });

    expect(await service.reset()).toEqual({ reset: false });
    expect(seeder).not.toHaveBeenCalled();
  });

  it("resets anyway once the quiet period has passed", async () => {
    const { service, seeder } = build({ lastActivityAt: new Date(Date.now() - 10 * 60_000) });

    expect(await service.reset()).toEqual({ reset: true });
    expect(seeder).toHaveBeenCalled();
  });

  it("forces through the quiet period when a visitor presses Reset demo", async () => {
    // The visitor pressing the button IS the recent activity, so the quiet
    // period must not swallow their own request.
    const { service, seeder } = build({ lastActivityAt: new Date() });

    expect(await service.reset({ force: true })).toEqual({ reset: true });
    expect(seeder).toHaveBeenCalled();
  });

  it("passes the configured demo addresses to the seeder", async () => {
    const { service, seeder } = build();

    await service.reset();

    expect(seeder).toHaveBeenCalledWith(expect.anything(), SLUG, {
      ownerEmail: "owner@demo.invalid",
      clientEmail: "client@demo.invalid",
    });
  });
});
