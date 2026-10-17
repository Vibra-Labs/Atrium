#!/bin/sh
# Fails if web code hardcodes an API address. Browser code must default to
# same-origin (""), and server code must go through lib/internal-api-url.ts,
# or the Docker image breaks (issue #82).
set -e

matches=$(git grep -nE 'process\.env\.API_URL|localhost:3001|NEXT_PUBLIC_API_URL *(\|\||\?\?) *"[^"]' -- \
  'apps/web/src' ':!apps/web/src/lib/internal-api-url.ts' ':!*.test.ts' ':!*.test.tsx' || true)

if [ -n "$matches" ]; then
  echo "Hardcoded API URLs in apps/web/src:"
  echo "$matches"
  echo
  echo "Browser code: use NEXT_PUBLIC_API_URL || \"\" (same origin)."
  echo "Server code: use serverFetch / INTERNAL_API_URL from @/lib/server-api."
  exit 1
fi
echo "No hardcoded API URLs."
