/**
 * One-time migration: backfill `task.status` from the legacy `completed` boolean.
 *
 * Old schema: `task.completed BOOLEAN`
 * New schema: `task.status STRING` with values `open` | `in_progress` | `done` | `cancelled`
 *
 * Mapping: completed=true → 'done', completed=false → 'open'.
 *
 * Run BEFORE `prisma db push --accept-data-loss` so `completed` still exists when this reads it.
 *
 * Usage: DATABASE_URL="..." bun run packages/database/scripts/migrate-task-completed-to-status.ts
 */

import { PrismaClient } from "@prisma/client";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const completedCol = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'task' AND column_name = 'completed'
    `;

    if (completedCol.length === 0) {
      console.log("Legacy task.completed column not found — nothing to migrate.");
      return;
    }

    const statusCol = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'task' AND column_name = 'status'
    `;

    if (statusCol.length === 0) {
      console.log("task.status column does not exist yet. Run prisma db push (without --accept-data-loss) first.");
      return;
    }

    // Idempotent: only touches rows still at the default 'open' with completed=true,
    // so re-runs won't clobber 'in_progress'/'cancelled' set by post-migration traffic.
    const result = await prisma.$executeRaw`
      UPDATE task
      SET status = 'done'
      WHERE completed = true AND status = 'open'
    `;

    console.log(`Backfilled ${result} task row(s) from completed=true → status='done'.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
