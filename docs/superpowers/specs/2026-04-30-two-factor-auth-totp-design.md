# Two-Factor Authentication (TOTP) — Design

**Date:** 2026-04-30
**Status:** Draft — pending implementation plan

## Summary

Add TOTP-based two-factor authentication to Atrium, with recovery codes, a 30-day trusted-device option, and an org-level enforcement toggle that targets staff (owners/admins) only. Clients can opt in but are never forced. Implemented via Better Auth's `twoFactor` plugin.

## Goals

- Provide users a familiar, well-supported second factor (TOTP via Google Authenticator, 1Password, Authy, etc.).
- Let org owners require 2FA for their staff without affecting clients.
- Work identically on self-hosted and cloud deployments — no external services or paid infra.
- Provide clear, documented recovery paths for both regular lockouts and owner lockouts.

## Non-Goals

- Passkeys / WebAuthn (separate future spec).
- SMS or email OTP.
- Per-trusted-device revocation UI (existing session sign-out covers it).
- Configurable trust-device duration (fixed at 30 days).
- Forcing clients into 2FA, even when the org toggle is on.
- Reminder emails / nudges to enroll.

## Scope Decisions (locked during brainstorm)

| Decision | Choice |
|---|---|
| Factors | TOTP + recovery codes only |
| Required vs optional | User opt-in by default; org owner can enable a "Require 2FA for staff" toggle |
| Who is eligible | All roles can opt in; enforcement applies to owners/admins only |
| Trusted device | 30-day trusted-device cookie, opt-in per login |
| Recovery (regular user) | Owner/admin can disable 2FA for the locked-out user from the team-members page |
| Recovery (owner lockout) | CLI script `bun run script:disable-2fa <email>` on the API server |

## Architecture

Three layers:

1. **Better Auth `twoFactor` plugin** — added to `AuthService` alongside the existing `organization` and `magicLink` plugins. Owns: TOTP secret generation, code verification, backup-code generation/hashing/verification, trust-device JWT cookie, and the challenge step in the login flow. Adds Prisma-backed tables via the adapter; picked up by `bun db:push`.
2. **Org enforcement layer (Atrium-owned)** — a new field on `SystemSettings`, a NestJS guard, and a small admin-only endpoint to disable 2FA for another user.
3. **UI surfaces (apps/web)** — settings page, login challenge page, forced-enrollment redirect, team-members "Disable 2FA" action, and trusted-device handling.

The auth controller proxy stays unchanged — Better Auth's plugin endpoints (`/api/auth/two-factor/*`) flow through the existing `@All("*path")` handler.

## Schema Changes

### Better Auth-managed (added by the plugin)

- New table `twoFactor` (or equivalent — Better Auth's adapter declares it). Stores `userId`, encrypted TOTP `secret`, hashed `backupCodes`. One row per user with 2FA enabled.
- New column `User.twoFactorEnabled Boolean @default(false)`.

We do not author migrations for these — the Better Auth adapter declares them and `bun db:push` applies them, matching the pattern used for `Session`, `Account`, and `Verification`.

### Atrium-authored

- New column on `SystemSettings`: `requireTwoFactor Boolean @default(false)`.
- No new tables.

The `SystemSettings` table already exists per-org and is the right home for this — it's where org-scoped configuration lives today.

## Auth Flows

### Setup (user opt-in)

1. User clicks "Enable 2FA" on `/dashboard/settings/security`.
2. Frontend calls `POST /api/auth/two-factor/enable` → Better Auth returns the TOTP secret and an `otpauth://` URI.
3. Web renders the QR code (using `qrcode` package, client-side) plus the secret as a copyable text fallback.
4. User enters a 6-digit code from their authenticator app.
5. Frontend calls `POST /api/auth/two-factor/verify` with the code. On success, Better Auth flips `user.twoFactorEnabled = true` and returns 10 single-use backup codes.
6. Web shows the backup codes once with **Copy** and **Download .txt** buttons and an "I've saved these" confirmation. The codes are never retrievable afterward.

### Login challenge

1. User submits email + password (unchanged).
2. If `twoFactorEnabled`, Better Auth returns 200 with `{ twoFactorRedirect: true }` instead of issuing a session cookie.
3. Web redirects to `/login/2fa`.
4. User enters a 6-digit code, or clicks **Use a recovery code** to enter one of the 10 backup codes.
5. On success, Better Auth issues the session cookie. If **Trust this device for 30 days** is checked, also sets the trust-device cookie.
6. Subsequent logins from that browser within 30 days skip steps 3–4 (the plugin checks the cookie before issuing the challenge).

### Disable (self-service)

- Settings → **Disable 2FA** → confirms with current TOTP code → Better Auth wipes the secret and backup codes.
- Blocked when `org.requireTwoFactor && member.role IN (owner, admin)` — the UI greys out the button with a tooltip explaining the org policy.

### Recovery — regular user lockout (admin-driven)

- On the team-members list, members with 2FA enabled show a shield icon.
- Owners/admins see a **Disable 2FA** action in the row's menu.
- Clicking it opens a confirmation modal. If the acting user has 2FA themselves, they must enter their own current TOTP code as confirmation.
- The frontend calls `DELETE /two-factor/admin/:userId` (Atrium-owned, not Better Auth).
- Server checks: same-org membership, acting user's role is `owner` or `admin`, target user exists.
- On success: clears the target user's `twoFactor` row and `User.twoFactorEnabled`. Server emits a structured pino log line at `info` level with `{ event: "two_factor.admin_disabled", actorId, targetUserId, organizationId }` so self-hosters and cloud operators can grep audit trails. (We don't write to `ActivityLog` because that table is project-scoped.)

### Recovery — owner lockout (CLI)

- New script: `apps/api/src/scripts/disable-2fa.ts`.
- Invoked as `bun run script:disable-2fa <email>` from `apps/api/`.
- Loads `PrismaService` standalone, finds the user, deletes the `twoFactor` row, sets `twoFactorEnabled = false`.
- Prints success or "user not found / does not have 2FA enabled".
- Documented in the project README under a **Recovery** section so self-hosters and cloud operators can find it.

## Org Enforcement

- Toggle on `/dashboard/settings/security` (owner-only): **Require 2FA for staff (owners and admins)**.
- New guard `TwoFactorEnforcementGuard` runs after `AuthGuard`.
  - Skips `@Public()` routes.
  - Skips routes under `/api/auth/two-factor/*` (so users can complete enrollment when forced).
  - Skips users whose role in the active org is `member` (clients are never forced).
  - For owners/admins of an org with `requireTwoFactor === true` and `user.twoFactorEnabled === false`, returns `403 { code: "TWO_FACTOR_REQUIRED" }`.
- The web app's API client interceptor catches `TWO_FACTOR_REQUIRED` and redirects to `/2fa/setup` — a forced version of the opt-in setup flow with no skip option.

## API Surface

### Better Auth endpoints (provided by plugin)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/two-factor/enable` | Start enrollment, returns secret + URI |
| POST | `/api/auth/two-factor/verify` | Confirm enrollment / verify login challenge |
| POST | `/api/auth/two-factor/disable` | Turn off (requires current code) |
| POST | `/api/auth/two-factor/verify-backup-code` | Use a recovery code |
| POST | `/api/auth/two-factor/generate-backup-codes` | Regenerate codes (requires current code) |

### Atrium-owned endpoints (new `two-factor/` module)

| Method | Path | Purpose |
|---|---|---|
| GET | `/two-factor/status` | Returns `{ enabled, requiredByOrg, hasBackupCodesRemaining }` for the current user |
| DELETE | `/two-factor/admin/:userId` | Owner/admin disables 2FA for another user in the same org |

## UI Surfaces (apps/web)

- `/dashboard/settings/security` — new page. Sections:
  - 2FA status (enabled/disabled), enable/disable button, regenerate backup codes.
  - Owner-only: **Require 2FA for staff** toggle.
- `/login/2fa` — challenge page. 6-digit input, **Use a recovery code** toggle, **Trust this device for 30 days** checkbox.
- `/2fa/setup` — forced enrollment when the org requires it. Same flow as opt-in setup but no exit/skip.
- Team-members list — shield icon for 2FA-enabled members; **Disable 2FA** admin action with confirmation modal.
- API client interceptor — catches `TWO_FACTOR_REQUIRED` and redirects to `/2fa/setup`.

## Error Handling

- Wrong TOTP code at enrollment: 400 from Better Auth, web shows inline "Invalid code" and lets the user retry.
- Wrong TOTP code at login: 400, inline error, retry. Better Auth handles rate-limiting / replay.
- Wrong recovery code at login: same as above.
- Trying to disable 2FA when org policy requires it: UI prevents (button greyed); server also rejects with 403 and a clear error code as a defense-in-depth.
- CLI script user-not-found: prints clear message, exits with non-zero code.
- CLI script user-without-2FA: prints "user does not have 2FA enabled", exits 0 (idempotent).

## Testing

### Unit (Bun, `*.spec.ts`)

- `TwoFactorEnforcementGuard`:
  - Public routes pass.
  - Clients (`role === member`) pass regardless of org policy.
  - Staff with 2FA enabled pass.
  - Staff without 2FA pass when `requireTwoFactor === false`.
  - Staff without 2FA return 403 with `code: TWO_FACTOR_REQUIRED` when `requireTwoFactor === true`.
  - `/api/auth/two-factor/*` routes bypass the guard so users can complete enrollment.
- Admin-disable endpoint:
  - Cross-org rejection (admin from org A cannot disable for user in org B).
  - Role check (member role rejected).
  - Pino log line emitted on success with `{ event: "two_factor.admin_disabled", actorId, targetUserId, organizationId }`.
- CLI script: happy path + user-not-found + user-without-2FA.

### E2E (Playwright, `e2e/tests/two-factor.e2e.ts`)

- **Opt-in:** setup → QR shown → wrong code rejected → right code accepted → backup codes shown → log out → log back in → challenge → success.
- **Trusted device:** login with **Trust this device** → log out → log back in same browser → no challenge served.
- **Recovery code:** login with a backup code → success → re-attempt with same code → rejected.
- **Org-enforced:** owner enables `requireTwoFactor` → admin without 2FA navigates dashboard → redirected to `/2fa/setup` → completes setup → reaches dashboard.
- **Admin disable:** target user logs in with just password successfully after admin disables 2FA on their account.
- **Clients exempt:** member role is never redirected to `/2fa/setup` even when the org toggle is on.

For generating valid TOTP codes in tests, use `otplib`'s `authenticator.generate(secret)` against the secret returned by `/two-factor/enable`.

## Migration / Rollout

- `bun db:push` adds the new tables/columns. No data migration needed (everyone starts as `twoFactorEnabled = false`, `requireTwoFactor = false`).
- Feature is invisible until a user opts in or an owner flips the toggle. No flag-gating needed.

## Open Questions

None at design freeze. If something surfaces during implementation it goes in the plan, not this spec.
