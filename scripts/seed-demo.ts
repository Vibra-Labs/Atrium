/** CLI wrapper: bun run db:seed:demo */
import { PrismaClient } from "@atrium/database";
import { seedDemo } from "../apps/api/src/demo/demo-seed";

const slug: string = process.env.DEMO_ORG_SLUG ?? "demo";
const prisma = new PrismaClient();

seedDemo(prisma, slug, {
  ownerEmail: process.env.DEMO_OWNER_EMAIL,
  clientEmail: process.env.DEMO_CLIENT_EMAIL,
})
  .then(({ organizationId }: { organizationId: string }) => {
    console.log(`Seeded the demo workspace "${slug}" (${organizationId}).`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
