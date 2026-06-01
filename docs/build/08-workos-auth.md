# 08 — WorkOS Auth Migration

## 1. What

Pexlo Portal now uses WorkOS/AuthKit as the canonical user authentication provider while preserving the existing Prisma `user`, `organization`, and `member` tables as the application source of truth.

Phase 3 linked Chris's existing WorkOS user to the existing Prisma user row and created the matching WorkOS organization membership for Pexlo Internal.

## 2. Why

Chris chose WorkOS as the long-term auth standard for Pexlo products. WorkOS gives Pexlo hosted AuthKit UX, enterprise SSO readiness, stronger audit/compliance posture, and removes the need to polish Better Auth's bare sign-in UI before client-facing use.

We intentionally keep local Prisma records canonical because existing project/task/comment/update data already references local `user.id`, `organization.id`, and `member` rows.

## 3. Considered & Rejected

### Keep Better Auth indefinitely
Rejected. It works, but it leaves Pexlo owning a custom auth UX and magic-link email flow that WorkOS already handles better.

### Replace the local `user` table with WorkOS IDs
Rejected. The portal already has local FKs from comments, project updates, memberships, and agent data. Replacing the table would turn a small auth-provider migration into a broad data migration.

### Create a duplicate WorkOS user for Chris
Rejected. WorkOS already had `chris@pexlo.com` from the Phase 2 smoke test. Creating again would duplicate or error. We updated and linked the existing WorkOS user instead.

### Rename the default WorkOS test organization
Attempted, then rejected by WorkOS. API returned `403 Default test organizations cannot be updated.` We created a real `Pexlo Internal` organization instead.

## 4. What We Built

### Existing code state before Phase 3

Phase 1/2 had already landed on `main` before this doc:

- `User.workosUserId String? @unique` exists in Prisma.
- API session middleware resolves WorkOS sealed-session cookies to local Prisma users.
- Web auth helpers and AuthKit routes are in place.
- Better Auth tables are retained for rollback safety.

### Phase 3 WorkOS objects

Created/updated in the WorkOS staging environment:

- WorkOS user: `user_01KSWMJYFTSCJHWXNC9BPP6F64`
  - email: `chris@pexlo.com`
  - first_name: `Chris`
  - last_name: `Burrill`
  - email_verified: `true`
  - external_id: local Prisma user id `2ZYf1yUNuUbPPwfKw1EV92GVh4zwJQsC`
- WorkOS organization: `org_01KSWT043W6RSEGS9H3Y6GEGZM`
  - name: `Pexlo Internal`
  - domain: `pexlo.com`, state `verified`
  - external_id: local Prisma organization id `70483073F84A4BFBBFE35B04`
- WorkOS membership: `om_01KSWT04A6KN45N3W37Q2RGNGV`
  - user: `user_01KSWMJYFTSCJHWXNC9BPP6F64`
  - organization: `org_01KSWT043W6RSEGS9H3Y6GEGZM`
  - status: `active`
  - role: `admin`

### Phase 3 Prisma linkage

Updated exactly one local user row:

- `user.email = 'chris@pexlo.com'`
- `user.id = '2ZYf1yUNuUbPPwfKw1EV92GVh4zwJQsC'`
- `user.workosUserId = 'user_01KSWMJYFTSCJHWXNC9BPP6F64'`

No Better Auth tables were dropped. No local users, organizations, projects, tasks, comments, deliverables, audit events, accounts, sessions, or verification rows were created/deleted.

## 5. How to Extend

### Add another existing local user

1. Verify the local Prisma user row first:
   ```sql
   SELECT id, email, name, "workosUserId" FROM "user" WHERE email = '<email>';
   ```
2. Check WorkOS for an existing user with that email.
3. If present, update that WorkOS user; do not create a duplicate.
4. If absent, create a WorkOS user.
5. Set WorkOS `external_id` to local `user.id`.
6. Set local `user.workosUserId` to the WorkOS user id in a guarded transaction.
7. Create or reuse a WorkOS organization and membership.
8. Run `./scripts/verify-workos-migration.sh` and a direct SQL check.

### Add a client organization

1. Create the local Prisma organization/member records first if they do not exist.
2. Create a matching WorkOS organization with `external_id = organization.id`.
3. Add/verify organization domain only after ownership is confirmed.
4. Add users as WorkOS organization memberships.
5. Link each local user via `workosUserId`.

### Safety rule

Every DB-mutating auth migration needs a fresh Neon safety branch immediately before mutation. WorkOS writes should be verified with API reads before and after.

## 6. Verification

### Safety branch

Fresh Neon branch created before the production DB update:

```text
branch id: br-jolly-cake-aqbqjnih
name: pre-workos-phase3-link-20260530-1202
parent: br-super-credit-aqwsbfbh
parent_lsn: 0/2EEBEA0
state: ready
created_at: 2026-05-30T16:02:23Z
```

### Preflight DB baseline

`./scripts/verify-workos-migration.sh` before mutation:

```text
account=2, api_key=2, audit_event=73, comment=13, organizations=71,
project_update=5, projects_total=30, projects_agent=3, session=5,
task_deliverable=27, tasks_total=17, tasks_agent=13, users=77,
verification=0
✅ No drift from baseline. Gate verification PASSED.
```

### Local Prisma user before update

```text
id: 2ZYf1yUNuUbPPwfKw1EV92GVh4zwJQsC
email: chris@pexlo.com
name: Chris Burrill
workosUserId: NULL
member organization: Pexlo / 70483073F84A4BFBBFE35B04
```

### WorkOS user after update

```json
{
  "id": "user_01KSWMJYFTSCJHWXNC9BPP6F64",
  "email": "chris@pexlo.com",
  "first_name": "Chris",
  "last_name": "Burrill",
  "email_verified": true,
  "external_id": "2ZYf1yUNuUbPPwfKw1EV92GVh4zwJQsC"
}
```

### WorkOS organization and membership after create

```json
{
  "organization": {
    "id": "org_01KSWT043W6RSEGS9H3Y6GEGZM",
    "name": "Pexlo Internal",
    "domain": "pexlo.com",
    "domain_state": "verified",
    "external_id": "70483073F84A4BFBBFE35B04"
  },
  "membership": {
    "id": "om_01KSWT04A6KN45N3W37Q2RGNGV",
    "status": "active",
    "role": "admin"
  }
}
```

### Prisma update result

```text
Before: chris@pexlo.com workosUserId = NULL
After:  chris@pexlo.com workosUserId = user_01KSWMJYFTSCJHWXNC9BPP6F64
UPDATE 1
users_total=77
users_linked=1
```

### Post-update row-count verification

`./scripts/verify-workos-migration.sh` after mutation:

```text
account=2, api_key=2, audit_event=73, comment=13, organizations=71,
project_update=5, projects_total=30, projects_agent=3, session=5,
task_deliverable=27, tasks_total=17, tasks_agent=13, users=77,
verification=0
✅ No drift from baseline. Gate verification PASSED.
```

Direct SQL after mutation:

```text
chris@pexlo.com workosUserId = user_01KSWMJYFTSCJHWXNC9BPP6F64
users_total=77
users_linked=1
```

## 7. Known Gaps / Deferred

- Full end-to-end hosted AuthKit sign-in still needs browser verification after deploy/callback environment is live.
- Better Auth tables (`session`, `account`, `verification`) remain in production for rollback safety.
- Bulk migration of other test users is deferred.
- Microsoft/Google SSO configuration remains dashboard-only v2 work.
- Default WorkOS test organization still exists and could not be renamed by API; it is harmless but should be ignored.

## 9. Session Refresh Fix (PR #32, 2026-06-01)

### What
WorkOS sealed-session access tokens are short-lived. `SessionMiddleware` originally called `sealedSession.authenticate()` and, on the inevitable token expiry after a few minutes, every request 401'd with "Authentication required" until a full re-login.

### Why
The access token embedded in the `wos-session` cookie expires well before the user's working session does. Without a refresh step, the middleware treated an *expired-but-refreshable* session identically to an *unauthenticated* one.

### What We Built
In `apps/api/src/auth/session.middleware.ts`: on `authenticate()` failure, call `sealedSession.refresh()`, write the re-sealed `wos-session` cookie back on the response, and proceed with the refreshed identity. If `refresh()` itself fails (revoked/expired refresh token), fall through to `AuthGuard` (real 401). Covered by `session.middleware.spec.ts` (4 cases: valid, expired+refreshable, expired+unrefreshable, no cookie).

Bundled billing fix: `/billing-clients?limit=200` was rejected by `PaginationQueryDto @Max(100)` → 400 surfaced on the billing page. Fixed with a paginated fetch helper in `apps/web/src/lib/api.ts`, applied across billing, calendar, clients, tasks-section, reports/time pages.

### How to Extend
The refresh-on-expiry pattern is the canonical handling for any new sealed-session consumer. Do not add a parallel auth check that skips refresh — route it through `SessionMiddleware`.

### Verification (2026-06-01 prod deploy, commit e70da4a, image 9b9f830ec6f2)
```
portal.pexlo.com/        -> 200
/api/health              -> 200
/portal/sign-in          -> 307 -> WorkOS authorize, redirect_uri=https://portal.pexlo.com/auth/callback (PKCE S256)
entrypoint migrations    -> image 8 = DB 8, "No pending migrations" (additive-only, abort-guard not tripped)
RestartCount             -> 0; pexlo-portal + pexlo-caddy both Up
```
Rollback image retained: `pexlo-portal:rollback-pre-deploy32-20260601-134948` (prior-good 6e8c7d0).

### Known Gaps / Deferred
- Client-side session-survival test (leave billing tab open ~5 min, confirm no re-login) — owed at deploy time.

## 8. References

- Migration plan: `docs/build/workos-migration-plan.md`
- Verification script: `scripts/verify-workos-migration.sh`
- Prisma schema: `packages/database/prisma/schema.prisma`
- WorkOS docs: https://workos.com/docs/user-management
- Linear: PXL-20 WorkOS migration, PR #32 session refresh
