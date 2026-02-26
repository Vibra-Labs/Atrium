# Changelog

All notable changes to Atrium will be documented in this file.

## [Unreleased] — VRB-28

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
