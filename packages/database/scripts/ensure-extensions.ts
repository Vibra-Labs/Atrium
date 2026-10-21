/**
 * Creates the Postgres extensions the schema depends on. Run this BEFORE
 * `prisma db push`.
 *
 * schema.prisma declares GIN trigram indexes (`gin_trgm_ops`) for the
 * unanchored ILIKE '%q%' searches, so `db push` fails if pg_trgm is missing.
 * The extension is created here rather than through Prisma's
 * `postgresqlExtensions` preview feature, so `db push` never manages it.
 * Idempotent.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  console.log("Postgres extension ready: pg_trgm");
}

main()
  .catch((err) => {
    console.error(
      "Could not create the pg_trgm Postgres extension. Atrium requires pg_trgm " +
        "(the search indexes in schema.prisma use gin_trgm_ops), so the schema push " +
        "fails without it. Run `CREATE EXTENSION IF NOT EXISTS pg_trgm;` as a database " +
        "superuser, or enable pg_trgm in your managed database's extension settings.",
      err,
    );
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
