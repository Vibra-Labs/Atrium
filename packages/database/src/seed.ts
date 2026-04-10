import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Resolve price IDs based on STRIPE_MODE (test/live)
const mode = process.env.STRIPE_MODE === "live" ? "LIVE" : "TEST";
const proPriceId = process.env[`STRIPE_${mode}_PRO_PRICE_ID`] || null;
const lifetimePriceId = process.env[`STRIPE_${mode}_LIFETIME_PRICE_ID`] || null;

const plans = [
  {
    name: "Free",
    slug: "free",
    stripePriceId: null,
    priceMonthly: 0,
    priceYearly: 0,
    priceLifetime: 0,
    maxProjects: 2,
    maxStorageMb: 50,
    maxMembers: 1,
    maxClients: 3,
    maxSeats: -1,
    isRecurring: false,
    features: ["2 projects", "50 MB storage", "1 team member", "3 clients"],
    description: "Get started with the basics",
    sortOrder: 0,
    isActive: true,
  },
  {
    name: "Pro",
    slug: "pro",
    stripePriceId: proPriceId,
    priceMonthly: 2900,
    priceYearly: 29000,
    priceLifetime: 0,
    maxProjects: -1,
    maxStorageMb: 10240,
    maxMembers: 5,
    maxClients: -1,
    maxSeats: -1,
    isRecurring: true,
    features: [
      "Unlimited projects",
      "10 GB storage",
      "5 team members",
      "Unlimited clients",
    ],
    description: "For growing agencies",
    sortOrder: 1,
    isActive: true,
  },
  {
    name: "Lifetime",
    slug: "lifetime",
    stripePriceId: lifetimePriceId,
    priceMonthly: 0,
    priceYearly: 0,
    priceLifetime: 49900,
    maxProjects: -1,
    maxStorageMb: 25600,
    maxMembers: 100,
    maxClients: -1,
    maxSeats: 100,
    isRecurring: false,
    features: [
      "Unlimited projects",
      "25 GB storage",
      "100 team members",
      "Unlimited clients",
      "Founder Discord access",
      "Limited to 100 total seats",
    ],
    description: "One-time payment, lifetime access",
    sortOrder: 2,
    isActive: true,
  },
];

async function main() {
  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { slug: plan.slug },
      update: {
        name: plan.name,
        stripePriceId: plan.stripePriceId,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
        priceLifetime: plan.priceLifetime,
        maxProjects: plan.maxProjects,
        maxStorageMb: plan.maxStorageMb,
        maxMembers: plan.maxMembers,
        maxClients: plan.maxClients,
        maxSeats: plan.maxSeats,
        isRecurring: plan.isRecurring,
        features: plan.features,
        description: plan.description,
        sortOrder: plan.sortOrder,
        isActive: plan.isActive,
      },
      create: plan,
    });
  }

  console.log("Seeded 3 subscription plans (Free, Pro, Lifetime).");
  console.log("Database ready. Create your first account at /signup.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
