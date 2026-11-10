/**
 * Removes the OAuth tables of Better Auth's old `mcp` plugin. Run this BEFORE
 * `prisma db push`.
 *
 * Better Auth 1.7 replaced that plugin with `@better-auth/mcp`, whose tables
 * have a different shape under some of the same names, so `db push` cannot
 * convert them in place. Nothing in them survives the switch anyway: client
 * registrations change format, so every MCP client has to sign in again.
 * Grants point at those dead client ids, so they go too.
 *
 * Idempotent: does nothing once `oauth_application` (old plugin only) is gone.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rows: { exists: boolean }[] = await prisma.$queryRawUnsafe(
    "SELECT to_regclass('public.oauth_application') IS NOT NULL AS exists",
  );
  if (!rows[0]?.exists) return;

  await prisma.$transaction([
    prisma.$executeRawUnsafe("DROP TABLE IF EXISTS oauth_access_token, oauth_consent, oauth_application CASCADE"),
    prisma.$executeRawUnsafe("DELETE FROM mcp_pending_grant"),
    prisma.$executeRawUnsafe("DELETE FROM mcp_grant"),
  ]);
  console.log("Removed the old MCP OAuth tables. Connected AI assistants need to sign in again.");
}

main()
  .catch((err) => {
    console.error("Could not remove the old MCP OAuth tables", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
