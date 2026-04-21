/**
 * One-time migration: backfill `task.status` from the legacy `completed` boolean,
 * and sanitize dangling FK references on `requestedById` / `assigneeId` before
 * those columns gain real FK constraints.
 *
 * Old schema: `task.completed BOOLEAN`
 * New schema: `task.status STRING` with values `open` | `in_progress` | `done` | `cancelled`
 *
 * Mapping: completed=true → 'done', completed=false → 'open'.
 *
 * Run BETWEEN the two `prisma db push` invocations:
 *   1. `prisma db push`                          (additive)
 *   2. this script                               (backfill + sanitize FKs)
 *   3. `prisma db push --accept-data-loss`      (drops `completed`, adds FKs)
 *
 * Usage: DATABASE_URL="..." bun run packages/database/scripts/migrate-task-completed-to-status.ts
 */

import { PrismaClient } from "@prisma/client";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    // ── Phase A: backfill legacy completed → status ──
    const completedCol = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'task' AND column_name = 'completed'
    `;

    if (completedCol.length === 0) {
      console.log("[backfill] Legacy task.completed column not found — skipping backfill.");
    } else {
      const statusCol = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'task' AND column_name = 'status'
      `;

      if (statusCol.length === 0) {
        console.log("[backfill] task.status column missing — run `prisma db push` (without --accept-data-loss) first.");
      } else {
        // Idempotent: only touches rows still at the default 'open' with completed=true,
        // so re-runs won't clobber 'in_progress'/'cancelled' set by post-migration traffic.
        const updated = await prisma.$executeRaw`
          UPDATE task
          SET status = 'done'
          WHERE completed = true AND status = 'open'
        `;

        console.log(`[backfill] Updated ${updated} task row(s): completed=true → status='done'.`);
      }
    }

    // ── Phase B: sanitize dangling FK references before constraints are added ──
    const nulledRequesters = await prisma.$executeRaw`
      UPDATE task
      SET "requestedById" = NULL
      WHERE "requestedById" IS NOT NULL
        AND "requestedById" NOT IN (SELECT id FROM "user")
    `;
    if (nulledRequesters > 0) {
      console.log(`[sanitize] Nulled ${nulledRequesters} dangling task.requestedById reference(s).`);
    }

    const nulledAssignees = await prisma.$executeRaw`
      UPDATE task
      SET "assigneeId" = NULL
      WHERE "assigneeId" IS NOT NULL
        AND "assigneeId" NOT IN (SELECT id FROM "user")
    `;
    if (nulledAssignees > 0) {
      console.log(`[sanitize] Nulled ${nulledAssignees} dangling task.assigneeId reference(s).`);
    }

    if (nulledRequesters === 0 && nulledAssignees === 0) {
      console.log("[sanitize] No dangling task FK references found.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
