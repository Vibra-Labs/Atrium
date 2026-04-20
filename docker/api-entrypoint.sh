#!/bin/sh
set -e

echo "Running database schema sync..."
bunx prisma db push --schema=./packages/database/prisma/schema.prisma --skip-generate
echo "Database ready."

echo "Running data migrations..."
bun run ./packages/database/scripts/migrate-task-completed-to-status.ts || true

if [ "${SUPABASE}" = "true" ]; then
  echo "Applying Row Level Security..."
  bun run ./packages/database/scripts/apply-rls.ts
  echo "RLS applied."
fi

exec bun run start:prod
