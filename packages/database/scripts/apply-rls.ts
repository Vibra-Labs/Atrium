import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";

const prisma = new PrismaClient();

async function main() {
  const sqlPath = resolve(__dirname, "../rls/enable-rls.sql");
  const sql = readFileSync(sqlPath, "utf-8");

  // Split into individual statements — required for PgBouncer/pooled connections
  // which don't support multiple commands in a single prepared statement.
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 0 &&
        !s.startsWith("--") &&
        s !== "BEGIN" &&
        s !== "COMMIT",
    );

  console.log("Applying Row Level Security policies...");
  await prisma.$transaction(
    statements.map((stmt) => prisma.$executeRawUnsafe(stmt)),
  );
  console.log("RLS applied successfully on all tables.");
}

main()
  .catch((err) => {
    console.error("Failed to apply RLS:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
