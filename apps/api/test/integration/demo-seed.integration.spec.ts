/**
 * The demo seed decides whether the public demo is usable at all: on the Free
 * plan `@PlanLimit` refuses a fourth project and `planHasFeature` 403s the
 * seeded contract and invoices, and a trial subscription would expire and
 * quietly cripple the demo two weeks after launch. Those are the properties
 * worth proving against a real database, not the prose.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { assertDisposableDatabase } from "./guard";
import { PrismaClient } from "@atrium/database";
import { seedDemo } from "../../src/demo/demo-seed";

const SLUG = "demo-seed-test";

let prisma: PrismaClient;

async function wipe(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!org) return;
  await prisma.organization.delete({ where: { id: org.id } });
}

describe("seedDemo", () => {
  beforeAll(async () => {
    assertDisposableDatabase();
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await wipe();
    // The demo is pinned to the pro plan and seedDemo refuses without it. These
    // tests truncate, and plans come from the main seed, so provide one here.
    await prisma.subscriptionPlan.upsert({
      where: { slug: "pro" },
      update: {},
      create: { name: "Pro", slug: "pro", priceMonthly: 2900, isRecurring: true },
    });
  });

  it("creates the demo org on the configured slug", async () => {
    const { organizationId } = await seedDemo(prisma, SLUG);

    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    expect(org?.slug).toBe(SLUG);
  });

  it("pins the org to the pro plan with no trial end", async () => {
    const { organizationId } = await seedDemo(prisma, SLUG);

    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });
    expect(subscription?.plan.slug).toBe("pro");
    expect(subscription?.trialEndedAt).toBeNull();
    expect(subscription?.status).toBe("active");
  });

  it("is idempotent: a second run leaves one org and the same counts", async () => {
    const first = await seedDemo(prisma, SLUG);
    const before = await prisma.project.count({ where: { organizationId: first.organizationId } });

    const second = await seedDemo(prisma, SLUG);

    expect(second.organizationId).toBe(first.organizationId);
    expect(await prisma.organization.count({ where: { slug: SLUG } })).toBe(1);
    expect(await prisma.project.count({ where: { organizationId: second.organizationId } })).toBe(
      before,
    );
  });

  it("seeds only @demo.invalid addresses", async () => {
    const { organizationId } = await seedDemo(prisma, SLUG);

    const members = await prisma.member.findMany({
      where: { organizationId },
      select: { user: { select: { email: true } } },
    });
    expect(members.length).toBeGreaterThan(1);
    for (const member of members) {
      expect(member.user.email.endsWith("@demo.invalid")).toBe(true);
    }
  });

  it("creates at least one project, task, invoice, document and contact", async () => {
    const { organizationId } = await seedDemo(prisma, SLUG);

    expect(await prisma.project.count({ where: { organizationId } })).toBeGreaterThanOrEqual(3);
    expect(await prisma.task.count({ where: { organizationId } })).toBeGreaterThan(0);
    expect(await prisma.invoice.count({ where: { organizationId } })).toBeGreaterThan(0);
    expect(await prisma.document.count({ where: { organizationId } })).toBeGreaterThan(0);
    expect(await prisma.contact.count({ where: { organizationId } })).toBeGreaterThan(0);
    expect(await prisma.timeEntry.count({ where: { organizationId } })).toBeGreaterThan(0);
  });

  it("gives the portal client a project to see, so the client entry is not empty", async () => {
    const { organizationId } = await seedDemo(prisma, SLUG);

    const clientMember = await prisma.member.findFirst({
      where: { organizationId, role: "member" },
      select: { userId: true },
    });
    expect(clientMember).not.toBeNull();
    expect(
      await prisma.projectClient.count({ where: { userId: clientMember!.userId } }),
    ).toBeGreaterThan(0);
  });

  it("marks one invoice paid and leaves one due, so both states are visible", async () => {
    const { organizationId } = await seedDemo(prisma, SLUG);

    expect(await prisma.invoice.count({ where: { organizationId, status: "paid" } })).toBe(1);
    expect(await prisma.invoice.count({ where: { organizationId, status: "sent" } })).toBe(1);
  });
});
