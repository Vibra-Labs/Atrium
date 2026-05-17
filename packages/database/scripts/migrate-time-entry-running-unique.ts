/**
 * Adds a partial unique index on `time_entry` that enforces at most one
 * running (endedAt IS NULL) entry per (organizationId, userId).
 *
 * Prisma 6 does not yet support `where:` filters on `@@unique`, so this
 * index must be applied via raw SQL. The index is idempotent — CREATE
 * UNIQUE INDEX IF NOT EXISTS will be a no-op on repeat runs.
 *
 * This must run AFTER `prisma db push` so the table exists.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS time_entry_one_running_per_user
  ON "time_entry" ("organizationId", "userId")
  WHERE "endedAt" IS NULL
`;

async function main(): Promise<void> {
  await prisma.$executeRawUnsafe(SQL);
  console.log("Applied partial unique index: time_entry_one_running_per_user");
}

main()
  .catch((err) => {
    console.error("Failed to apply time_entry running unique index:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
