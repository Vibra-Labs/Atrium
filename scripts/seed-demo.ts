/** CLI wrapper: bun run db:seed:demo */
import { PrismaClient } from "@atrium/database";
import { seedDemo } from "../apps/api/src/demo/demo-seed";
import { DEMO_DEFAULT_ORG_SLUG } from "../apps/api/src/demo/demo-config";

// The default comes from the API's own definition: the seed writing one
// workspace while the API looks for another is the single failure that makes
// a correctly configured demo serve a 404, and no unit test on either side
// can see it.
const slug: string = process.env.DEMO_ORG_SLUG ?? DEMO_DEFAULT_ORG_SLUG;
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
