# 09 — Billing System v1 (PLAN, pre-implementation)

**Status:** Planning — to be executed Sunday May 31, 2026 fresh-brain morning.
**Author:** Omni (Saturday May 30, 2026 evening prep)
**Reviewed by:** Chris (pending — read before kickoff)

## 1. What

Add a `/dashboard/billing` workspace built on existing time-tracking + invoice infrastructure. Primary user workflow:

1. Pick a client (currently CSP, more later)
2. Pick a date range (weekly, bi-weekly, monthly, custom)
3. See all unbilled time grouped by day, with project + task + description per line
4. "Generate Invoice Draft" → creates Invoice row, attaches time entries via `invoiceLineItemId`, takes them out of the "unbilled" pool
5. View the draft in a copy-paste-friendly format that maps cleanly to Digits invoice line items
6. "Mark Sent" once entered in Digits (with optional external reference number)

## 2. Why

Chris currently invoices through Digits but needs:
- A timesheet view organized by day showing what was worked on (not project totals — daily activity logs)
- A way to flag which time was already billed so he doesn't double-bill
- Per-client billing context (rate, terms, billing period)
- A flexible date range (weekly / bi-weekly / monthly per client)

The portal already has 90% of this infrastructure. The build is mostly a **client-grouping layer + a new UI surface**, not a from-scratch billing system.

## 3. What's ALREADY built (codebase audit findings)

This is the critical pre-build finding. **Most of the system exists already.**

### TimeEntry model (`packages/database/prisma/schema.prisma`)
```
id, organizationId, projectId, taskId, userId, description,
startedAt, endedAt, durationSec,
billable: Boolean,
hourlyRateCents: Int? (frozen rate snapshot at creation),
invoiceLineItemId: String? (← the "billed for" flag we wanted)
```

### Invoice + InvoiceLineItem models
Already have:
- `invoiceNumber` auto-generated as `INV-XXXX`
- `status: draft | sent | paid`
- `type: itemized | uploaded`
- Project FK, organizationId, dueDate, notes
- Line items with description, quantity, unitPrice (cents)
- Stripe Connect payment tracking fields (out of scope for billing flow but present)

### API endpoints already shipping

`POST /api/time-entries/generate-invoice` (in `apps/api/src/time-entries/time-entries.service.ts`):
- ✅ Filters by date range (from/to)
- ✅ Excludes non-billable (configurable via `includeNonBillable`)
- ✅ Excludes already-invoiced entries (`invoiceLineItemId: null`)
- ✅ Backfills missing rates from project/member current rate
- ✅ Transactional invoice + line item + entry-link creation (Serializable isolation, P2002 retry)
- ✅ Two modes: `mergeEntries=true` (one line per rate, total hours @ rate) or one line per entry
- ✅ Per-entry frozen rate handling preserves historical accuracy across rate changes

`GET /api/time-entries/report`:
- ✅ Filters by date range, projectId, userId
- ✅ Aggregates at the database via `groupBy` (memory-bounded for huge datasets)
- ✅ Returns totals, byProject, byUser
- ✅ Has CSV export with throttling

### UI already shipping

`/dashboard/reports/time/page.tsx`:
- ✅ Date range picker
- ✅ Project filter
- ✅ Loads `/time-entries/report`, renders totals + breakdowns
- ✅ CSV export button
- ✅ `formatHours`, `fmtMoney` helpers already exist

`/dashboard/projects/[id]/time-tab.tsx`:
- Per-project time view (running timer, manual entries, list)

`/dashboard/projects/[id]/components/generate-from-time-modal.tsx`:
- The invoice generator UI, currently scoped to a single project

## 4. What's MISSING — the actual gap

Three concrete additions, in order:

### Gap 1: `Client` model + `Project.clientId` FK
**The only schema work.** Currently invoices are tied to projects, projects are tied to org. There's no entity representing "the external business I bill" — that's implicit in projects, with `Project.hourlyRateCents` as the rate hint.

For the per-client rate model + multi-project rollups (e.g., "all CSP work this period across N projects"), we need a `Client` entity.

```prisma
model Client {
  id                     String   @id @default(cuid())
  organizationId         String
  organization           Organization @relation(...)
  name                   String
  slug                   String?
  defaultHourlyRateCents Int?
  billingPeriod          String?  // 'weekly' | 'biweekly' | 'monthly' | 'custom'
  billingNotes           String?  // Net 15, payment instructions, etc.
  externalReference      String?  // e.g. "Digits Customer ID 12345"
  archivedAt             DateTime?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  
  projects               Project[]
  
  @@unique([organizationId, slug])
  @@unique([organizationId, name])
  @@index([organizationId, archivedAt])
  @@map("client")
}

// Add to Project:
clientId String?
client   Client? @relation(fields: [clientId], references: [id], onDelete: SetNull)
```

Pure additive migration. Project.clientId is nullable (Pexlo internal projects have no client).

### Gap 2: `clientId` filter on existing endpoints
- `GET /api/time-entries/report?clientId=X` — extend the existing report endpoint
- `GET /api/time-entries?clientId=X` — extend list filter
- `POST /api/time-entries/generate-invoice` — accept `clientId` mode (generates one invoice spanning ALL projects for that client, vs current project-scoped mode)

Smallest possible API surface change. ~6 lines of WHERE clause additions across 3 methods.

### Gap 3: `/dashboard/billing` UI surface

**Three new pages.** Reuses existing components heavily.

**`/dashboard/billing` (index)**
- List of active clients
- For each: name, default rate, unbilled hours (last 90 days), total billed YTD
- "Add Client" button → modal or detail page
- Click client → `/dashboard/billing/[clientId]`

**`/dashboard/billing/[clientId]` (workspace)**
- Reuses 80% of `/reports/time` layout
- Date range picker with presets (This Week, Last Week, Last 2 Weeks, Last Month, Custom)
- Calls existing `/time-entries/report?clientId=X&from=Y&to=Z`
- Below the totals: NEW component "unbilled by day" — renders entries grouped by date, showing project + task + description + hours per row
- Footer: total hours, computed total $ (using client default rate or per-entry frozen rate), "Generate Invoice Draft" button
- Button triggers `POST /time-entries/generate-invoice` with `clientId` mode

**`/dashboard/billing/invoices/[id]` (draft viewer)**
- Display the generated invoice in copy-paste-friendly format
- Header: invoice #, client name, status badge, date range
- Body: time entries grouped by day in plain text format like:
  ```
  Mon May 26 — 8.0 hrs
    Pexlo Portal: WorkOS migration (auth refactor + Phase 2b)
    CSP IT: Microsoft 365 audit prep
  
  Tue May 27 — 6.5 hrs
    Pexlo Portal: Phase 2c web refactor
  ```
- Per-day or per-line "Copy" buttons
- Sidebar: total hours, total $, line item count
- Actions: "Mark Sent" (optional Digits reference), "Revert Draft" (releases entries back to unbilled, status=draft only)

## 5. Considered & Rejected

### Build a full Digits API integration
**Rejected.** Digits API surface is limited and the integration risk is high. Copy-paste workflow is fine for a solo operator. Revisit if Pexlo grows to multiple billers.

### Add `Client` model AND `Customer` model (separate concepts)
**Rejected.** Premature. For now Client = external billable entity. If we ever need "many users belong to a Client" (e.g., multiple contacts at CSP who can see different things in the portal), we'll add `ClientUser` then.

### Use existing `ProjectClient` for the client concept
**Rejected.** `ProjectClient` is a user↔project membership (Soyini sees CSP projects via this). It's not a billable-entity model. Different concept, same word.

### Build a new generator instead of extending existing
**Rejected.** The existing `generateInvoice` is well-tested and handles edge cases (rate backfill, frozen-rate snapshotting, transaction safety). Extending with a `clientId` mode is way smaller surface than rebuilding.

### Single-PR full build
**Rejected.** Per the new SOUL rule about non-trivial PR review. Split into 4-5 small PRs Chris can review one at a time.

## 6. Backfill plan (one-time data work)

Current Pexlo org has 5 projects, of which 3 are CSP work:

| Project | Should clientId be... |
|---|---|
| Pexlo R&D Tax Credit Briefing for CSP — Briefing No. 001 | CSP |
| CSP Internal Operations Platform — Phase 0 Discovery | CSP |
| CSP IT Onboarding — May 2026 | CSP |
| Billing System v1 (this very project) | NULL (internal) |
| PXL-20 Phase 5 — Post-Migration Cleanup | NULL (internal) |

Backfill steps:
1. Create 1 Client row: `name='CSP'`, `slug='csp'`, `defaultHourlyRateCents=null` (Chris sets in UI)
2. Update 3 projects with the CSP clientId
3. Done. ~5 minutes of SQL inside a transaction with a Neon safety branch first.

## 7. PR breakdown (Sunday morning execution)

### PR 1 — Schema + backfill (~30 min)
- Add Client model
- Add Project.clientId nullable FK
- Prisma migration
- Backfill script (or psql + transaction)
- Neon safety branch first per Hard Rule 8

### PR 2 — Extend existing API endpoints with clientId (~30 min)
- `TimeEntryListQueryDto`: add `clientId?: string`
- `time-entries.service.ts` `list()` + `report()`: add WHERE filter
- `GenerateInvoiceDto`: add `clientId?: string` (mutually exclusive with `projectId`)
- `generateInvoice()`: branch on which one is set; if clientId, find all unbilled entries across all that client's projects
- Add `clients` controller (CRUD)
- Tests for the new clientId path

### PR 3 — `/dashboard/billing` index + Client CRUD UI (~45 min)
- List page: clients with unbilled hours, total billed YTD
- Add/edit client modal (name, default rate, billing period, notes)
- Wire to /api/clients endpoints

### PR 4 — `/dashboard/billing/[clientId]` workspace (~45 min)
- Copy `/reports/time/page.tsx` as starting point
- Add `clientId` to the report query
- Add date range presets
- Add "unbilled by day" grouped view
- "Generate Invoice Draft" button → triggers existing endpoint with clientId

### PR 5 — `/dashboard/billing/invoices/[id]` draft viewer + build doc (~30 min)
- New page reading existing Invoice + InvoiceLineItem
- Render copy-paste-friendly format
- "Mark Sent" / "Revert Draft" actions wired to existing invoice update endpoints
- Build doc cleanup: convert this PLAN.md to a proper "Build" doc per AGENTS.md format

**Total estimated focused work: ~3 hours.** Halved from my earlier 5-hour estimate because of the codebase audit finding.

## 8. Open questions for Chris (answer before/during Sunday morning kickoff)

1. **CSP default hourly rate** — what's the actual number? Or set NULL and Chris enters in UI on first run?
2. **Digits invoice line item format** — Chris to send a screenshot or describe so the "copy-friendly" format matches exactly. Without this, I'll guess based on common invoice formats (day → project: task description, X hrs).
3. **Billing period default for CSP** — bi-weekly? Weekly? Custom?
4. **Should the "Revert Draft" button exist Phase 1, or punt to Phase 2** for safety? (Concern: accidentally reverting an actually-sent invoice if Mark Sent step is skipped.)
5. **Do clients need their own portal view** later (Soyini sees only her client's projects), or is that handled by ProjectClient already? (Probably no change needed today — Soyini's access via ProjectClient is already working.)

## 9. Hard rules for execution

- **Neon safety branch before any DB mutation** (Hard Rule 8)
- **Each PR reviewed by Chris before merge** (new SOUL rule from May 30)
- **Audit existing code before designing extensions** (new permanent rule from this prep session)
- **No O'Reilly research needed** — codebase patterns are already production-grade for: frozen-rate snapshotting, transactional invoice generation, lex-safe invoice numbering, idempotent rate backfill
- **Build doc mandatory before PR #5 closes**

## 10. References

- `apps/api/src/time-entries/time-entries.service.ts` (existing `generateInvoice` + `report` — primary reference)
- `apps/api/src/invoices/invoices.controller.ts` (CRUD pattern for sister surface)
- `apps/api/src/projects/projects.controller.ts` (CRUD pattern + AuthGuard + Roles)
- `apps/web/src/app/(dashboard)/dashboard/reports/time/page.tsx` (UI pattern to extend)
- `apps/web/src/app/(dashboard)/dashboard/projects/[id]/components/generate-from-time-modal.tsx` (existing generator UI)
- AGENTS.md Hard Rules 7-14 + Investigative QC section
- SOUL.md May 30 rules (look, don't assume; surface QC fails; PR review for non-trivial)

---

## TL;DR

Build is 90% already done. Real work is:
1. Add Client model (1 table)
2. Add `clientId` to existing query filters (6 lines)
3. New `/dashboard/billing` surface (3 pages, mostly reusing existing patterns)

3 hours, 5 PRs, Sunday morning.
