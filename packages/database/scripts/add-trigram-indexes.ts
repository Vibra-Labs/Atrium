/**
 * Adds pg_trgm GIN indexes so the unanchored ILIKE '%q%' searches (global
 * search, contacts list) can use an index instead of scanning every row.
 *
 * Prisma cannot express operator-class indexes, so these are applied via raw
 * SQL. Everything is idempotent. Managed databases may not allow
 * CREATE EXTENSION; in that case this logs and exits cleanly (search still
 * works, just without the indexes).
 *
 * This must run AFTER `prisma db push` so the tables exist.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const INDEXES: { name: string; table: string; column: string }[] = [
  { name: "contact_name_trgm_idx", table: "contact", column: "name" },
  { name: "contact_email_trgm_idx", table: "contact", column: "email" },
  { name: "company_name_trgm_idx", table: "company", column: "name" },
  { name: "task_title_trgm_idx", table: "task", column: "title" },
  { name: "project_name_trgm_idx", table: "project", column: "name" },
];

async function main(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  } catch (err) {
    console.warn("Could not create pg_trgm extension; skipping trigram indexes:", err);
    return;
  }
  for (const { name, table, column } of INDEXES) {
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS ${name} ON "${table}" USING gin ("${column}" gin_trgm_ops)`,
    );
    console.log(`Applied trigram index: ${name}`);
  }
}

main()
  .catch((err) => {
    console.error("Failed to apply trigram indexes:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
