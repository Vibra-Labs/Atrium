# Changelog

All notable changes to Atrium will be documented in this file.

## [1.3.0] — 2026-03-14

### Added

#### Documents
- Upload documents (quotes, contracts, NDAs) to projects with file type restrictions (PDF, Word, ODT, images)
- Clients can accept, decline, or acknowledge documents from the portal
- Document status automatically updates based on all client responses
- Response audit trail with IP address and user agent logging
- Expandable document list with response details in dashboard

#### Decision Tasks
- New "decision" task type with configurable options (2–5 choices)
- Clients vote on decisions from the portal; vote counts hidden until voting is closed
- Admins/owners can close voting, which marks the task as completed
- Vote changes allowed (upsert) until voting is closed

#### Invoice Uploads
- Upload pre-built invoice files (PDF/image) as an alternative to itemized invoices
- Uploaded invoices store a total amount in cents and link to the uploaded file
- Invoice stats and notification emails correctly handle both itemized and uploaded types
- Outstanding amount calculation now only counts "sent" and "overdue" statuses (excludes drafts)

#### Payment Settings
- Configure payment instructions, method (bank transfer, PayPal, Stripe link, other), and details in system settings
- Payment details encrypted at rest (AES-256-GCM)
- `GET /api/settings/payment-instructions` endpoint accessible to all authenticated users (including clients)

#### Other
- Configurable rate limiting via `THROTTLE_LIMIT` and `SIGNUP_THROTTLE_LIMIT` env vars
- Shared `downloadFile` utility for client-side file downloads

### Database

- New models: `Document`, `DocumentResponse`, `DecisionOption`, `DecisionVote`
- New fields on `Task`: `type`, `question`, `closedAt`
- New fields on `Invoice`: `type`, `amount`, `uploadedFileId`
- New fields on `SystemSettings`: `paymentInstructions`, `paymentMethod`, `paymentDetails`
- New relation on `File`: `documents`, `invoices`

### Upgrade Notes

This release includes schema changes that add new tables and columns. All new columns have defaults, so no data migration is needed.

- **Docker deployments**: The entrypoint runs `prisma db push` automatically — no action required.
- **Manual / `prisma migrate` deployments**: Run `bun run db:push` (or `npx prisma db push`) before starting the new version. If you use `prisma migrate deploy`, generate a migration first with `npx prisma migrate dev` against the updated schema.

## [1.2.1] — 2026-03-12

### Added
- Default Atrium logo on landing page and sidebar (falls back when no custom branding is set)
- "Hide logo" toggle in branding settings for orgs without a company logo
- Sidebar and portal header automatically reflect branding changes after save (no refresh needed)

### Fixed
- README image paths not rendering on GitHub (`public/` → `./public/`)

## [1.2.0] — 2026-03-11

### Added

#### Account Deletion
- Owners can delete their account and cascade-delete their organization (projects, files, invoices, clients)
- Password re-authentication required before deletion
- Type-to-confirm dialog requiring `DELETE <org name>`
- `GET /api/account/deletion-info` preflight endpoint returns org ownership context
- Clients (non-owners) can delete their own account from portal settings
- E2E tests for deletion flow, credential invalidation, and non-owner visibility

#### Supabase Row Level Security
- `enable-rls.sql` enables RLS on all 21 tables and revokes `anon`/`authenticated` access
- `bun run db:rls` command to apply manually
- Docker entrypoints apply RLS automatically when `SUPABASE=true`
- Safe for plain Postgres — gated behind env var, skipped by default

#### Docker
- Built-in PostgreSQL 16 bundled in the unified Docker image — no separate database container needed
- `USE_BUILT_IN_DB` toggle: set to `false` with a `DATABASE_URL` to use an external database
- Graceful shutdown of built-in PostgreSQL on container stop
- Docker Hub overview with quick start, Compose examples, and env var reference
- `scripts/update-dockerhub-readme.sh` to push Docker Hub description from `docker/DOCKERHUB.md`
- Docker deployment documentation (`docs/docker.md`)

#### Unraid
- Unraid Community Applications template with single-container setup
- Template repo at `Vibra-Labs/unraid-templates` linked as git submodule
- PR submitted to `selfhosters/unRAID-CA-templates` for CA listing

#### Invitations
- Accept-invite auto-login when a user signs up with an already-existing account
- Accept-invite sets active organization before redirect

#### UX
- Portal `/portal` redirects to `/portal/projects`
- Danger zone section visible to all dashboard users (owners and non-owners)

### Security
- Comprehensive security audit with findings documented in `SECURITY_AUDIT.md`
- DTO validation added for project and task inputs (`@IsDateString`, `@MaxLength`)
- Path traversal protection in local file storage (reject `..` in keys)
- Branding logo upload restricted to image MIME types
- Update attachment size validated against system settings before storage
- Caddyfile hardened with `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` headers
- PostgreSQL port no longer exposed to host in production `docker-compose.yml`
- Generic password verification error message to prevent user enumeration
- `DELETED_USER_SENTINEL` constant in shared package for anonymized user references

### Changed
- Deploy workflow now only pushes to Docker Hub (removed Google Cloud Run and Firebase Hosting steps)
- Shared `setActiveOrgAndRedirect` helper replaces duplicated org-switch-and-redirect logic
- Organization deletion now purges file blobs from storage provider (not just DB records)

### Fixed
- Dockerfile missing `ca-certificates` package broke PostgreSQL apt repo setup

## [1.1.0] — 2026-03-09

### Added

#### Billing & Subscriptions
- Stripe integration with test/live mode toggle via `STRIPE_MODE`
- Subscription plans (Free, Pro, Lifetime) with DB-seeded configuration
- Checkout flow via Stripe Checkout Sessions
- Stripe Customer Portal for managing payment methods
- Webhook handler for checkout, subscription updates, invoice events
- Usage meters (projects, storage, team members, clients) on billing page
- Plan limit enforcement via `PlanGuard` and `@PlanLimit()` decorator
- Lifetime plan with seat cap tracking
- Lazy free plan initialization for orgs created before billing was enabled

#### Performance
- In-memory session cache (30s TTL) — reduces DB round trips from 8+ to 2 per page load
- Auth routes bypass and invalidate cache to prevent stale org context

### Fixed

- Auth controller uses `BETTER_AUTH_URL` for request origin instead of `WEB_URL`
- Session cache invalidation on auth mutations prevents 401 "Organization context required" errors
- Invoice update/delete mutations now scope Prisma queries to `organizationId` (prevents potential cross-org TOCTOU race)
- Browser autofill no longer overrides dark mode input backgrounds
- Sign-in button shows spinner during login

### Security

- Removed scripts containing hardcoded credentials
- Sanitized infrastructure docs (removed project IDs and service refs)
- GitHub Actions deploy workflow uses variables instead of hardcoded URLs
- Added `.firebase/`, `.firebaserc`, `firebase.json`, `*.pem`, `*.key` to `.gitignore`

### Database

- New models: `SubscriptionPlan`, `Subscription`
- Subscription linked to Organization (1:1) with Stripe customer/subscription IDs
- Plan features stored as string array, limits as integers (-1 = unlimited)

## [1.0.2] — 2026-03-02

### Security
- Fix IDOR in invoice creation and project client assignment
- Remove SVG uploads, sanitize Content-Disposition headers
- Add access control to update attachment and file list endpoints

### Fixed
- Invoice status transition validation, PDF page breaks, dueDate clearing
- Linkify regex `/g` flag bug, SMTP cache scoping and TTL eviction
- Notification emails now receive organizationId for SMTP routing

### Changed
- Deduplicate `assertProjectAccess`, `contentDisposition`, and `linkify` into shared helpers
- Replace all `any` types with proper type definitions

## [1.0.1] — 1.0.1

### Added

#### Tasks
- Create, reorder, and track tasks per project
- Inline task creation with due date picker in dashboard
- Clients see read-only task lists in the portal
- Client notification emails on task creation

#### Invoicing
- Full invoice lifecycle with auto-numbered invoices (INV-0001)
- Line items with quantity, unit price, and calculated totals
- Status workflow: draft → sent → paid / overdue
- Invoice stats dashboard (total, outstanding, paid amounts)
- Client-facing invoice list and detail views in portal
- Client notification emails when invoices are sent

#### Internal Notes
- Team-only notes on projects (create, list, delete)
- Collapsible "Internal Notes (Team Only)" section in project detail
- Fully isolated from client portal

#### Client Profiles
- Self-service profile editing (company, phone, address, website, description)
- Admin profile viewing in client list
- Profile form in portal settings

#### Email Verification
- Verification email sent on signup via Better Auth
- `/verify-email` page with verified/unverified states
- Non-blocking dashboard banner with "Resend verification email" button
- Email verification is optional — self-hosted users without email can still log in

#### Notifications
- Email notifications for project updates (sent to all assigned clients)
- Email notifications for new tasks
- Email notifications when invoices are marked as sent
- Fire-and-forget delivery — notification failures never block API responses
- Parallel email delivery via `Promise.allSettled`

#### System Settings
- `SystemSettings` Prisma model with per-organization config
- Admin settings UI at `/dashboard/settings/system`
- Email provider configuration (Resend or SMTP) from the UI
- Sensitive fields encrypted at rest (AES-256-GCM with HKDF-derived key)
- Dynamic file upload size limits (configurable per org, 1-500 MB)
- "Send Test Email" button to verify email config
- DB settings with env-var fallbacks: `DB setting → env var → default`

#### Setup Wizard
- 5-step first-run wizard at `/setup` for new organizations:
  1. Organization profile (name, logo, colors)
  2. Email configuration (None / Resend / SMTP with test send)
  3. Create first project
  4. Invite first client
  5. Completion summary
- Automatic redirect from dashboard for owners who haven't completed setup
- Steps 2-4 are skippable

#### Security
- CSRF protection via double-submit cookie pattern
- Auth secret validation — refuses to start in production with default secret
- File download authorization — members must be assigned to the project
- CSRF guard skips unauthenticated requests (no session = no CSRF risk)
- CSRF token auto-retry on first mutating request from the frontend

### Fixed

- Invitation email grammar: "You have been invited you" → "You have been invited"
- Welcome email template wired up (was dead code)
- Invoice number race condition — serializable transaction with P2002 retry
- `@IsEmail()` validator no longer rejects `null` when clearing email settings
- File size validation returns HTTP 413 (`PayloadTooLargeException`) instead of 400
- Invoice stats computed via DB aggregation instead of loading all records into memory
- Welcome email failures now logged instead of silently swallowed
- SMTP transporter cached and reused instead of created per email
- Multer hard limit lowered from 500 MB to 200 MB
- `sanitizeFilename` deduplicated into shared utility
- Update attachments now appear in Files tab immediately (file list refreshes after posting/deleting updates)

### Changed

- Signup redirects to `/setup` wizard instead of directly to `/dashboard`
- Invoice numbers use 4-digit padding (INV-0001 instead of INV-001)
- Encryption key derived via HKDF instead of using auth secret directly
- Frontend settings page uses boolean flags instead of fragile mask string comparison

### Database

- New models: `Task`, `Invoice`, `InvoiceLineItem`, `ProjectNote`, `ClientProfile`, `SystemSettings`
- New relations on `Project`: `tasks`, `invoices`, `notes`
- Added `setupCompleted` field to `Organization` model
- Added indexes on `Member` table (`organizationId`, `userId`)

### Tests

- 165 unit tests across 16 test files (0 failures)
- New test suites: settings service, settings DTO, invoices service, notifications service, mail service, setup controller, sanitize utility
- Updated: CSRF guard (19 tests), files service (13 tests)
- E2E tests for all new features: tasks, invoicing, notes, client profiles, email verification, notifications, system settings, setup wizard, portal isolation
