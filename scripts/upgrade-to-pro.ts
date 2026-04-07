/**
 * Upgrades your organization's subscription to Pro directly in the DB.
 * Run with: bun scripts/upgrade-to-pro.ts
 */
import { PrismaClient } from "../packages/database/src/index";

const prisma = new PrismaClient();

async function main() {
  const proPlan = await prisma.subscriptionPlan.findUnique({ where: { slug: "pro" } });
  if (!proPlan) {
    console.error("Pro plan not found — run `bun run db:seed` first.");
    process.exit(1);
  }

  // Find all orgs (usually just one in local dev)
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  if (orgs.length === 0) {
    console.error("No organizations found.");
    process.exit(1);
  }

  for (const org of orgs) {
    await prisma.subscription.upsert({
      where: { organizationId: org.id },
      create: {
        organizationId: org.id,
        planId: proPlan.id,
        status: "active",
      },
      update: {
        planId: proPlan.id,
        status: "active",
        cancelAtPeriodEnd: false,
      },
    });
    console.log(`✓ Upgraded "${org.name}" to Pro`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
