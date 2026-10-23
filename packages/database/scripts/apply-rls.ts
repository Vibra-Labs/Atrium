import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";
import { rlsStatements } from "../rls/rls-statements";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const sqlPath: string = resolve(__dirname, "../rls/enable-rls.sql");
  const statements: string[] = rlsStatements(readFileSync(sqlPath, "utf-8"));

  console.log("Applying Row Level Security policies...");
  await prisma.$transaction(
    statements.map((stmt: string) => prisma.$executeRawUnsafe(stmt)),
  );
  console.log("RLS applied successfully on all tables.");
}

main()
  .catch((err) => {
    console.error("Failed to apply RLS:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
