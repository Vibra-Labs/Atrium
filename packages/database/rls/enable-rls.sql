-- =============================================================================
-- Enable Row Level Security on all Atrium tables
-- =============================================================================
-- This script is IDEMPOTENT -- safe to run multiple times.
--
-- Purpose: Lock down Supabase's PostgREST surface. The `anon` and
-- `authenticated` roles lose all direct table access. The `postgres`
-- superuser (used by Prisma / the API) bypasses RLS automatically.
--
-- No permissive policies are created, so even if RLS is enabled, the
-- anon/authenticated roles have zero access through PostgREST.
-- =============================================================================

BEGIN;

-- ─── Enable RLS on every table ──────────────────────────────────────────────
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY is a no-op if already enabled.

ALTER TABLE "user"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "member"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitation"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_client"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "file"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_update"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_line_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_note"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_profile"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branding"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "system_settings"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_status"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_key"           ENABLE ROW LEVEL SECURITY;

-- ─── Revoke direct access from anon and authenticated roles ─────────────────
-- REVOKE is idempotent -- revoking a privilege that was never granted is a no-op.

REVOKE ALL ON "user"              FROM anon, authenticated;
REVOKE ALL ON "session"           FROM anon, authenticated;
REVOKE ALL ON "account"           FROM anon, authenticated;
REVOKE ALL ON "verification"      FROM anon, authenticated;
REVOKE ALL ON "organization"      FROM anon, authenticated;
REVOKE ALL ON "member"            FROM anon, authenticated;
REVOKE ALL ON "invitation"        FROM anon, authenticated;
REVOKE ALL ON "project"           FROM anon, authenticated;
REVOKE ALL ON "project_client"    FROM anon, authenticated;
REVOKE ALL ON "file"              FROM anon, authenticated;
REVOKE ALL ON "project_update"    FROM anon, authenticated;
REVOKE ALL ON "task"              FROM anon, authenticated;
REVOKE ALL ON "invoice"           FROM anon, authenticated;
REVOKE ALL ON "invoice_line_item" FROM anon, authenticated;
REVOKE ALL ON "project_note"      FROM anon, authenticated;
REVOKE ALL ON "client_profile"    FROM anon, authenticated;
REVOKE ALL ON "branding"          FROM anon, authenticated;
REVOKE ALL ON "system_settings"   FROM anon, authenticated;
REVOKE ALL ON "project_status"    FROM anon, authenticated;
REVOKE ALL ON "subscription_plan" FROM anon, authenticated;
REVOKE ALL ON "subscription"      FROM anon, authenticated;
REVOKE ALL ON "api_key"           FROM anon, authenticated;

COMMIT;
