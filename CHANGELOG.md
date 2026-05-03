# Changelog

All notable changes to Atrium will be documented in this file.

## [1.8.0] — 2026-05-02

### Added

- **Time tracking, built for billable work** — Track every billable hour without leaving the project. Start and stop timers from the project's Time tab, watch elapsed time tick live, label work as you go, and never lose a session to a forgotten timer thanks to cross-project switch protection. Add or edit past entries in seconds, then turn un-invoiced time into a polished invoice in one click — automatically grouped by hourly rate so mixed-rate work bills cleanly.
- **Redesigned calendar** — Get the whole month at a glance with a faster, more readable layout: roomy day cells, weekend shading, color-coded event chips for tasks, project milestones, and invoices, plus a month/year jumper and filters that show what's active at a glance. Toggle to Agenda view for a chronological run-down.
- **Streamlined invoice creation** — A single "New Invoice" button now opens a clean menu for creating from scratch, generating from tracked time, or uploading a PDF — replacing the old triple-button row.
- **Reorganized Settings** — Settings is now a tabbed workspace (General, Profile, Workspace, Payments, Branding, Billing) so each area has room to breathe and you always know where to find what you need.

## [1.7.0] — 2026-04-30

### Added

- **View as customer** — See your client portal exactly the way your client sees it. Owners and admins can launch a preview from the Clients list or from any project's client chips, with a clear banner indicating you're in preview mode. Mutations are safely blocked end-to-end (server-side and in the UI), so you can explore freely without changing any real data.

## [1.6.3] — 2026-04-28

### Fixed

- **Saved branding colors were ignored on the dashboard and setup wizard** — the org's primary/accent colors persisted correctly and applied in the client portal, but the `(dashboard)` and `(setup)` route group layouts never set the `--primary`/`--accent` CSS variables, so buttons and accents fell back to the default theme. Both layouts now fetch branding server-side and apply the saved colors via inline CSS variables, matching the portal layout. Reported in #43.

## [1.6.2] — 2026-04-28

### Fixed

- **Client invite signup landed on the org setup wizard** — when an invitee already belonged to another org (e.g. their own agency), the post-invite redirect picked an arbitrary `orgs[0]` as the active org and routed by *that* org's role, sending the client to `/dashboard` (or `/setup` if that org's wizard was incomplete) instead of the inviting org's portal. The invited org id from `acceptInvitation` is now pinned as active before redirecting.

## [1.6.1] — 2026-04-27

### Fixed

- **Password reset emails were never sent** — the forgot-password form posted to `/api/auth/forget-password`, an endpoint Better Auth renamed to `/api/auth/request-password-reset` in v1.4. Requests 404'd silently, so no email was generated. Reported in #40.
- **Auth emails ignored per-org email config** — reset, verification, magic-link, and invitation emails routed through the default sender instead of the System Settings SMTP/Resend config. Each callback now resolves the user's primary org and threads `organizationId` into `MailService.send` so per-org configs are honored.

### Added

- **Admin "Send password reset link" action** — owners and admins can generate a reset URL for any team or client member from `/dashboard/clients`. The link is delivered by email when configured and also surfaced in-app for out-of-band sharing on self-hosted setups where email is unreliable. Owners can reset other owners; admins cannot reset owners; nobody can reset themselves. New `POST /clients/:id/reset-password` endpoint.

## [1.6.0] — 2026-04-26

### Added

- **Link-type file entries** — The Files section now supports adding external links (Nextcloud, Canva, Notion, Google Drive, etc.) alongside hard-uploaded files. A single "+ Add" menu on the project files header replaces the previous upload button with two clearly labeled options (Upload file / Add link). Link entries open in a new tab and do not count against the plan storage quota. Visible read-only in the client portal.
- **oEmbed discovery for project updates** — Project update URLs are now resolved via a server-side oEmbed registry covering Canva, Spotify, SoundCloud, CodePen, and Vimeo. Existing regex providers (YouTube, Loom, Figma, Google Docs) remain a zero-network fast path. Provider HTML is sanitized to an iframe-only allowlist with per-provider host pinning; failed resolutions silently degrade to plain links. Embed cards are capped to `max-w-xl` so they don't dominate the timeline. Twitter/X is intentionally deferred — its oEmbed response is a `<blockquote>` + widgets.js script, which our iframe-only sanitizer rejects.

### Changed

- `POST /files/link` endpoint added (owner/admin only). `download`/`remove` paths branch on file `type` so link entries are never fetched from storage. CSP `frame-src` extended for the new providers' embed hosts.

### Database

- `File.type` (`UPLOAD | LINK`, default `UPLOAD`), `File.url`, `File.description` added. `storageKey`/`mimeType`/`sizeBytes` are now nullable to accommodate link entries; all existing readers filter to `type = UPLOAD` or tolerate nulls.

## [1.4.4] — 2026-04-21

### Added

- **Client task requests** — Clients can submit task requests directly from the project portal via a "New Request" button. Requests appear in the agency's task list with a "Client Request" badge and requester attribution. Clients can cancel their own pending requests; agency members can assign, update status, and resolve them.
- **Task status workflow** — Tasks now have an explicit status (`todo`, `in_progress`, `in_review`, `done`, `cancelled`) instead of a boolean `completed` flag. Dashboard task list supports server-side status filtering. Status changes trigger in-app notifications for the assignee and requester.
- **Task assignee picker** — Agency members can assign tasks to any org member from the dashboard task row. Assignment changes send a notification to the new assignee.
- **Ticket-style task detail modal** — Clicking a task opens a detail modal with description, status, assignee, requester, and an inline label picker. Deep-linking via `?task=<id>` auto-opens the modal and switches to the Tasks tab on both dashboard and portal.
- **Task notifications** — New notification types for client requests, task assignments, and status changes (deduplicated to avoid spamming on rapid edits).

### Changed

- `POST /tasks/mine` endpoint added for client request creation; `PATCH /tasks/:id/cancel` added for client self-cancellation. Existing `POST /tasks` strips `requestedById` from agency-side creates and validates `assigneeId` org membership.
- CSV export of tasks now includes status, assignee, and requester columns.
- Dashboard task list status filter moved to the server; the page now resets to page 1 when the filter changes.

### Fixed

- Task creation modal label picker was clipped by modal overflow — replaced the popover with an inline picker.
- Dashboard task list no longer issues N+1 member lookups when rendering assignees and requesters.
- Playwright `NEXT_PUBLIC_API_URL` was not inlined into the dev web bundle because Next.js only auto-loads envs from its own package directory; the e2e config now pre-loads the monorepo root `.env` before spawning servers.

### Database

- Replaced `task.completed` boolean with `task.status` enum.
- Added `task.requestedById` and `task.assigneeId` with indexes.
- Added composite index on `task(projectId, status)` for filtered list queries.

## [1.4.3] — 2026-04-07

### Added

- **Plan limit upsell prompts** — Free-plan users now see contextual upgrade prompts at the point of friction: a usage counter and upgrade card on the Projects page, member/client limit banners on the People page, and a locked input with inline `PRO` badge on the Custom Domain setting.
- **Billing page redesign** — Plans section is now the primary focus (moved above current plan details). Pro card is visually highlighted with a teal border and "Most Popular" badge. Lifetime card includes a founding member spots meter and a "Become a Founding Member" CTA. Usage meters are compact (2-column, small text).
- **Contextual upgrade banner** — Arriving at the billing page via an upsell prompt now shows a banner explaining why you're there (projects limit, clients limit, or custom domain).
- **Founder Discord access** — Added as a feature bullet on the Lifetime plan.

### Fixed

- Invoice delete button was hidden for `overdue` and `cancelled` invoices — now any non-`paid` invoice without a Stripe payment intent can be deleted.
- Upsell components were reading `sub.plan` directly but the billing API wraps it as `sub.subscription.plan`, causing plan limits to never apply.
- Billing tab not opening when navigating to `/dashboard/settings/account?tab=billing` — `billingEnabled` wasn't in the sync effect's dependency array, so the tab stayed on Profile until a second interaction.
- Upgrade links redirected through `/dashboard/settings/billing` (which itself redirected) — all links now point directly to `?tab=billing`.

## [1.4.2] — 2026-04-05

### Added

- **Optional telemetry** — Self-hosters are prompted on first login to opt in to anonymous crash reporting via Sentry. Owners can change their preference at any time in Settings → General → Error Reporting. No personal data, client data, or identifiable information is ever included. See [docs/telemetry.md](docs/telemetry.md) for a full breakdown of what is and isn't collected.

### Security

- **Sentry `beforeSend` scrubber** — All Sentry configs (browser, Next.js server, edge, API) strip cookies, `Authorization` headers, and any user identity fields before events are transmitted, making the "no PII" guarantee enforceable at the code level.

## [1.4.1] — 2026-04-05

### Added

- **Custom domains** — Point your own domain (e.g. `portal.yourcompany.com`) to the client portal. Caddy provisions SSL automatically on first visit. Includes DNS setup instructions for Cloudflare, Route 53, GoDaddy, Namecheap, and more. On hosted plans this is a paid feature; self-hosters get it for free.
- **Branded login page** — The `/login` page now automatically shows your logo and brand colors on single-org (self-hosted) instances. No configuration needed — upload a logo in Settings and it appears. Hosted users can find their `/login/[slug]` URL with a copy button in Branding settings.
- **Dynamic payment methods** — The Payments settings section now fetches your Stripe account's active capabilities and shows only the payment methods available to you (Card, ACH, SEPA, iDEAL, Klarna, Affirm, Afterpay, and more). Inactive BNPL methods link directly to the Stripe dashboard to enable them. Selected methods are persisted and used when generating Stripe Checkout sessions.

### Changed

- **Settings page redesigned** — System Settings reorganised into three tabs (Branding, General, Payments) instead of a single long scroll. Save buttons are scoped to each section.
- **Runtime billing config** — `BILLING_ENABLED` is now read at runtime via `GET /api/health/config` instead of being baked into the Next.js build. Changing billing state no longer requires a rebuild.
- **Env var cleanup** — `BETTER_AUTH_URL` consolidated into `API_URL`. `NEXT_PUBLIC_DOMAIN` and `MAIN_DOMAIN` removed — the app now derives the hostname from `WEB_URL`. Existing deployments using `BETTER_AUTH_URL` continue to work via a backwards-compatible fallback.
- Better Auth sessions now persist for 30 days instead of expiring at the end of the browser session.

### Fixed

- Settings page crashing with `Cannot read properties of undefined (reading 'slug')` when billing subscription response was missing the `plan` field.
- Billing plan selection not loading plans on the signup page when `billingEnabled` resolved asynchronously.

### Upgrade Notes

If you set `BETTER_AUTH_URL` in your `.env`, rename it to `API_URL`. The old name still works as a fallback but will be removed in a future release.

## [1.4.0] — 2026-04-04

### Added

- **Client invoice payments via Stripe** — Clients can now pay invoices directly from the portal with a "Pay Now" button. Supports Direct Keys (paste your Stripe secret key) or Stripe Connect OAuth for a white-labeled experience. Invoices are automatically marked as paid when the Stripe webhook fires.
- **Global search** — Full-text search across projects, files, clients, and updates. Open with `Cmd+K` from anywhere in the dashboard.

### Changed

- **Invoice draft/send UX** — Invoice creation modal now has separate "Save as Draft" and "Send to Client" buttons, replacing the previous two-step flow. Draft invoices are hidden from the client portal.
- Docker deployment guide updated with Stripe Connect environment variables (`STRIPE_CONNECT_CLIENT_ID`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_CURRENCY`).
- New `docs/stripe.md` covering both Direct Keys and Connect modes with step-by-step setup instructions.

### Fixed

- Duplicate search dialog appearing when both GlobalSearch instances received `Cmd+K` simultaneously.
- Hardcoded `X-Forwarded-Proto: https` in Caddyfile that caused issues behind certain reverse proxies.
- `DIRECT_URL` fallback in Docker entrypoint to prevent Prisma validation errors on startup.

## [1.3.4] — 2026-04-01

### Added

- **Global search** — Press `⌘K` (or `Ctrl+K`) anywhere in the dashboard to open a command palette that searches across projects, tasks, files, and people in real time. Results are grouped by type with keyboard navigation (arrow keys + Enter). A search icon in the top-right sidebar header provides a mouse-accessible trigger.
- **Content embedding** — Paste a YouTube, Loom, Figma, or Google Docs/Sheets/Slides link into any project update and an inline preview will automatically appear below the text. Up to 3 embeds per update. A fallback "Open in …" link is shown for providers that require login.

## [1.3.3] — 2026-03-21

### Added

- **Comments** — Reply to project updates and tasks from the dashboard or portal.
- **Client updates** — Clients can now post updates from the portal.
- **Tags & Labels** — Create org-wide labels in System Settings and assign them to projects, tasks, files, and clients. Filter projects by label on the projects list page. Colored badges display throughout the dashboard.
- **In-app notifications** — Real-time notification bell in the dashboard and portal with unread count, mark-as-read, and mark-all-read.
- **Push notifications** — Browser push notifications for project updates, task assignments, and comments via Web Push (VAPID). Service worker included.
- **CSV data export** — Download projects, invoices, people, and tasks as CSV files from their respective pages.

### Security

- **kysely** override `0.28.11` → `0.28.14` — fixes two SQL injection vulnerabilities (CVE-2026-32763, CVE-2026-33468)
- **fast-xml-parser** override `5.4.1` → `5.5.7+` — fixes XML entity expansion (CVE-2026-33036) and input validation (CVE-2026-33349)

### Upgrade Notes

New database tables: `comment`, `label`, `project_label`, `task_label`, `file_label`, `member_label`, `notification`, `push_subscription`. New relation columns on `project`, `task`, `file`, and `member`. Docker handles this automatically via `prisma db push` in the entrypoint; bare-metal deployments must run `bun run db:push` after updating.

## [1.3.2] — 2026-03-21

### Added

#### Mobile-Responsive UI
- **Collapsible sidebar** — Slide-out hamburger menu on mobile with backdrop, auto-close on navigation
- **Adaptive project detail** — Collapsible `<details>` card for project metadata on mobile so tabs are immediately accessible
- **Responsive layouts** — Padding, tab bars, and flex layouts adapt across all dashboard and portal views
- **Responsive button labels** — "Upload Invoice" shortens to "Upload" on small screens

#### Testing
- Mobile navigation e2e tests (hamburger visibility, drawer open/close, route-change auto-close, desktop sidebar)

### Fixed
- Email errors in password reset and verification now propagate to the user instead of being silently swallowed
- Removed PII (email addresses) from error logs in onboarding controller
- Signup error logging now captures only `message` and `code` instead of full error object

### Security
- Next.js updated to 15.5.14 (patches CVE HTTP request smuggling + disk cache exhaustion)

## [1.3.1] — 2026-03-18

### Breaking Changes

- **Documents start as drafts** — Uploaded documents are no longer immediately visible to clients. Admins must click "Send to Client" (or use "Upload & Send") to make them visible. Existing pending documents are unaffected.
- **New version resets responses** — When an admin uploads a new version of a sent/signed document, all client responses and signatures are cleared and the document returns to "pending" for re-review. This enables scope change tracking but means clients must re-sign.
- **Unified upload flow** — The separate "Upload File" button is removed. All uploads go through the document modal (title, type, optional signature/approval). For quick file shares, use type "Other" and hit "Upload & Send".

### Added

#### Document Lifecycle
- **Draft status** — Documents start as drafts, invisible to clients until explicitly sent
- **Send workflow** — `Send to Client` transitions draft → pending and notifies clients via email
- **Void documents** — Cancel sent documents with optional reason; clients see read-only "Voided" badge
- **Audit trail** — Every document action (created, sent, viewed, signed, voided, expired) logged with timestamp, user, IP, and user agent. Viewable from the dashboard

#### E-Signature Enhancements
- **Field types** — Signature, date (auto-fill), initials, text input, and select (radio options) fields
- **Signing order** — Sequential signing enforcement; locked fields show "Waiting..." until prior signers complete
- **Signer assignment** — Assign specific fields to specific project clients
- **Admin signing** — Admins/owners can sign documents directly from the dashboard
- **Type-to-sign default** — Signature pad now defaults to type mode (draw still available)

#### Expiration & Reminders
- **Document expiration** — Set expiry (7/14/30/60/90 days) when sending; auto-expired by hourly cron
- **Automatic reminders** — Email reminders to unresponsive clients at configurable intervals (1-7 days)

#### Direct Signing Links
- **Access tokens** — Generate secure signing links for clients (SHA-256 hashed, time-limited)
- **Public signing page** — `/portal/sign/[token]` renders signing UI without portal login
- **Token revocation** — Admins can revoke individual signing links
- **Token cleanup** — Daily cron deletes expired tokens older than 30 days

#### Completion Certificate
- **PDF certificate** — Auto-generated completion certificate with document info, signer table, and full audit trail
- **Download** from both dashboard and portal when document is fully signed

#### Client Choices
- **Question with options** — Attach a question with radio button choices to any document; client must select one

#### UI Improvements
- **Unified Files tab** — Documents and files merged into single "Files" tab with one Upload button
- **Simplified upload modal** — Progressive disclosure: title + type + file upfront, signature checkbox for PDFs, advanced options collapsed
- **Upload & Send** — Primary CTA sends immediately; Save Draft for preparation
- **Auto-populate title** from filename on file selection
- **Three-tier action bar** — Primary action (solid button), secondary actions (icon group), destructive actions (right-aligned, danger on hover)
- **Continuous PDF scroll** — All pages render in a scrollable view with lazy loading via IntersectionObserver
- **Voided/expired states** in portal — Read-only badges, no action buttons

#### Document Versioning
- **Version history** — Upload new file versions to any document (draft or sent). Previous versions preserved with uploader name and timestamp
- **Restore versions** — Restore any previous version with one click; creates a new version entry for traceability
- **Scope change tracking** — Uploading a new version on a sent document resets to "pending" so clients re-review the changes
- **Version badge** — Documents with multiple versions show a "v2", "v3" etc. badge

#### Direct Signing Links
- **Generate signing links** — Create secure, time-limited signing URLs for specific clients from the dashboard
- **Manage links** — View active links, copy URLs, and revoke links per document
- **Token security** — SHA-256 hashed tokens, rate-limited public endpoints, auto-cleanup of expired tokens

#### Email Templates
- `DocumentReminderEmail` — Reminder for unresponsive clients with optional expiry date
- `DocumentSigningTurnEmail` — "Your turn to sign" notification for sequential signing

#### Testing
- 82 unit tests for `DocumentsService` covering all business logic paths
- 13 new E2E API tests (send, void, audit trail, field locking, token generation, expiry validation)

### Fixed
- Certificate page overflow — audit trail now properly spans multiple pages
- Token endpoint response filtered — no internal IDs exposed to unauthenticated users
- Signature fields locked on sent documents — prevents editing after clients have signed
- `requiresSignature` enforced as PDF-only on the API
- Send blocked for signature documents with zero fields placed
- `expiresInDays` validated on send endpoint (1-365 range)
- Signing audit events logged synchronously for compliance
- Notification type safety — removed unsafe `as any` cast
- `fetchSigningInfo` stale closure fixed in signing viewer

### Upgrade Notes

Schema changes require `bun run db:push`. **Data migration needed**: run `bun run packages/database/scripts/migrate-document-sent-at.ts` to backfill `sentAt` on existing pending documents. New tables: `document_audit_event`, `document_access_token`. New columns on `document` and `signature_field` models.

## [1.3.0] — 2026-03-17

### Added

- **Documents** — Upload quotes, contracts, and NDAs to projects. Clients review inline and accept/decline with optional reason. Admin sees status, decline reason, and can reset to re-request.
- **Decision tasks** — New task type where clients vote on options. Vote counts hidden until all clients have voted.
- **Activity feed** — Document responses and decision votes appear in the project updates timeline.
- **Email notifications** — Clients notified on document uploads, invoice uploads, and decision results. Admins notified on client responses.
- **Invoice uploads** — Upload PDF/image invoices as an alternative to itemized invoices.
- **Payment settings** — Configure payment instructions and method (bank transfer, PayPal, Stripe, other) with encrypted storage.
- **Portal UX** — Pending actions banner, badge counts on Files tab, confirmation dialog on accept/decline, inline document viewer modal.
- **Responsive layout** — Dashboard and portal stack vertically on small screens; tabs scroll, forms wrap.
- Configurable rate limiting via `THROTTLE_LIMIT` and `SIGNUP_THROTTLE_LIMIT` env vars.

### Fixed

- Portal invoice pagination now filters server-side by project (was client-side, broke page counts)
- Activity logging errors now logged instead of silently swallowed
- Tracker script injection hardened: `NEXT_PUBLIC_TRACKERS` validated against attribute whitelist
- React hydration mismatch (#418) suppressed on root elements

### Upgrade Notes

Additive schema changes only (new tables + nullable columns). No data migration needed. Docker entrypoint handles it automatically; manual deployments run `bun run db:push`.

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
