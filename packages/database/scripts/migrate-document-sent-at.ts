/**
 * One-time migration: backfill `sentAt` on existing pending documents.
 *
 * Documents created before the draft/send workflow was introduced
 * have status="pending" but sentAt=null. This sets sentAt=createdAt
 * so that reminders and expiry work correctly.
 *
 * Usage: bun run packages/database/scripts/migrate-document-sent-at.ts
 *
 * This script is idempotent — safe to re-run.
 */

import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    // Find pending docs without sentAt
    const docs = await prisma.document.findMany({
      where: { status: "pending", sentAt: null },
      select: { id: true, createdAt: true },
    });

    if (docs.length === 0) {
      console.log("No documents need migration.");
      return;
    }

    console.log(`Found ${docs.length} document(s) to migrate...`);

    // Update each doc's sentAt to its createdAt
    for (const doc of docs) {
      await prisma.document.update({
        where: { id: doc.id },
        data: { sentAt: doc.createdAt },
      });
    }

    console.log(`Migrated ${docs.length} document(s): set sentAt = createdAt`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
