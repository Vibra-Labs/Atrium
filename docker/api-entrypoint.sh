#!/bin/sh
set -e

MIGRATION_URL="${DIRECT_URL:-$DATABASE_URL}"

# Phase 1: Create new tables/columns without dropping legacy ones
echo "Running database schema sync (phase 1: additive)..."
DATABASE_URL="$MIGRATION_URL" bunx prisma db push --schema=./packages/database/prisma/schema.prisma --skip-generate 2>/dev/null || true

# Phase 2: Data migrations (idempotent; legacy columns still present)
echo "Running data migrations..."
DATABASE_URL="$MIGRATION_URL" bun run ./packages/database/scripts/migrate-task-completed-to-status.ts

# Phase 3: Drop legacy columns now that data is migrated
echo "Running database schema sync (phase 2: drop legacy columns)..."
DATABASE_URL="$MIGRATION_URL" bunx prisma db push --schema=./packages/database/prisma/schema.prisma --skip-generate --accept-data-loss
echo "Database ready."

if [ "${SUPABASE}" = "true" ]; then
  echo "Applying Row Level Security..."
  DATABASE_URL="$MIGRATION_URL" bun run ./packages/database/scripts/apply-rls.ts
  echo "RLS applied."
fi

exec bun run start:prod
