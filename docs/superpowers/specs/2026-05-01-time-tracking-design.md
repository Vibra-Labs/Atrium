# Time Tracking — Design

**Date:** 2026-05-01
**Status:** Approved — pending implementation plan

## Summary

Add staff time tracking to Atrium. Owners and admins log time against projects (optionally tied to a task) using either a live timer or a manual entry. Entries default to billable, snapshot an hourly rate at creation time, and roll up into invoice line items via a new "Generate from time" flow. Reports surface totals per project / user / period.

## Goals

- Give freelancers and agencies a first-class place to track billable hours alongside the projects they're already managing in Atrium.
- Make turning logged time into invoices a one-click flow that reuses the existing invoice + line-item models.
- Keep historical accuracy: changing a rate later does not silently re-price entries already logged.
- Stay strictly internal — clients neither see nor track time. They only see the resulting invoice line items.

## Non-Goals

- Approval / submission workflows.
- Time off, PTO, holiday tracking.
- Estimates vs actuals on tasks (no progress bars or burn-down).
- Budget alerts / over-budget warnings.
- Multi-currency rates (entries inherit the org's existing single-currency model).
- Calendar integration (separate planned feature).
- Exposing a timer or a "time on this project" summary to clients.
- Editing or back-dating an entry once it's been linked to an invoice line item.

## Scope Decisions (locked during brainstorm)

| Decision | Choice |
|---|---|
| Who tracks | Staff only (owner + admin). Members (clients) get 403 on every time-entry endpoint. |
| Tracking modes | Live timer (one running per user; starting a new one auto-stops the previous) and manual entry (start+end OR date+duration) |
| Granularity | Per project; optional task link (`taskId?`) |
| Billable flag | Per-entry boolean, default `true` |
| Rate source | `Project.hourlyRateCents` if set, else `Member.hourlyRateCents`, else `null` |
| Rate snapshot | Each entry stores `hourlyRateCents` at create time. Future rate edits never affect historical entries. |
| Invoicing | New endpoint generates an invoice **draft** from un-invoiced billable entries on a project (with optional date range). Each entry becomes an `InvoiceLineItem`. |
| Double-billing guard | On generation, each entry stores `invoiceLineItemId`. Subsequent generations skip linked entries. |
| Edit/delete lock | Entries linked to an invoice line are immutable. Deleting an invoice unlinks its entries (they become billable again). |
| Reports location | `/dashboard/reports/time` (new top-level "Reports" sidebar entry). |
| CSV export | Reports page has CSV export of the filtered set. |
| Default rate UI | Owner-only inline editor on the team-members page. Project-level override on the project settings page. |

## Architecture

Three layers:

1. **Database** — One new model (`TimeEntry`) plus three small column additions (`Member.hourlyRateCents`, `Project.hourlyRateCents`, `InvoiceLineItem` ↔ `TimeEntry` back-relation). Migration via `bun db:push`.
2. **API** (`apps/api/src/time-entries/`) — A new NestJS module with controller, service, DTOs, and unit tests. Endpoints for CRUD, start/stop, the invoice-from-time generator, and the report query. Plus small surgical edits to `members` (PUT default rate), `projects` (PUT project rate), and `invoices` (DELETE unlinks entries).
3. **Web** (`apps/web`) — Persistent timer widget (top bar of the dashboard layout), Time tab on the project page, dedicated reports page, "Generate from time" wizard on the invoices page, default-rate fields on team + project settings.

E2E coverage: timer round-trip, manual entry, invoice generation, double-billing rejection, client lockout.

## Data Model

### New: `TimeEntry`

```prisma
model TimeEntry {
  id                String           @id @default(cuid())
  organizationId    String
  organization      Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  projectId         String
  project           Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  taskId            String?
  task              Task?            @relation(fields: [taskId], references: [id], onDelete: SetNull)
  userId            String
  user              User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  description       String?          @db.VarChar(1000)
  startedAt         DateTime
  endedAt           DateTime?        // null while a timer is running
  durationSec       Int?             // computed on stop / set on manual entry
  billable          Boolean          @default(true)
  hourlyRateCents   Int?             // snapshot at create time
  invoiceLineItemId String?          @unique
  invoiceLineItem   InvoiceLineItem? @relation(fields: [invoiceLineItemId], references: [id], onDelete: SetNull)
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  @@index([organizationId, userId, startedAt])
  @@index([projectId, startedAt])
  @@index([taskId])
}
```

**Invariants:**
- Exactly one of `(endedAt, durationSec)` is null when running, both are set when stopped (server enforces).
- A user has at most one entry with `endedAt = null` at any time (enforced in service: starting a new timer auto-stops the old one in a single transaction).
- An entry with `invoiceLineItemId != null` is read-only via the API (PATCH/DELETE return 409).

### Modified: `Member`

```prisma
hourlyRateCents Int?
```

### Modified: `Project`

```prisma
hourlyRateCents Int?
```

### Modified: `InvoiceLineItem`

Add back-relation only; no new columns. The relation is 1:1 because each entry maps to exactly one line item:

```prisma
timeEntry TimeEntry?
```

## API Surface

All endpoints are `@Roles("owner", "admin")` and live under `/time-entries` unless noted.

| Method | Path | Purpose |
|---|---|---|
| GET    | `/time-entries`                                  | List entries for the org with filters: `projectId`, `userId`, `from`, `to`, `billable`, `invoiced`, paginated |
| POST   | `/time-entries`                                  | Create a manual entry (`startedAt`, `endedAt`, `projectId`, optional `taskId`, `description`, `billable`) |
| PATCH  | `/time-entries/:id`                              | Edit an entry (locked once invoiced) |
| DELETE | `/time-entries/:id`                              | Delete an entry (locked once invoiced) |
| POST   | `/time-entries/start`                            | Start a timer (`projectId`, optional `taskId`, `description`). Auto-stops any running timer for the user. Returns the new running entry. |
| POST   | `/time-entries/stop`                             | Stop the user's currently running timer. Returns the stopped entry. |
| GET    | `/time-entries/running`                          | Returns the current user's running entry, or `null`. Used by the top-bar widget on every dashboard load. |
| GET    | `/time-entries/report`                           | Aggregated report: totals (billable/non-billable/seconds/value cents) grouped by project + user; respects same filters as list |
| GET    | `/time-entries/report/export`                    | CSV export of the filtered raw entries |
| POST   | `/time-entries/generate-invoice`                 | Body `{ projectId, from?, to?, includeNonBillable? }`. Creates a `draft` invoice with one line item per eligible entry; sets `invoiceLineItemId` on each. Returns `{ invoiceId }`. |

Modified existing endpoints:

| Method | Path | Change |
|---|---|---|
| PUT    | `/clients/:id/rate`                              | Owner-only. Sets `Member.hourlyRateCents`. |
| PUT    | `/projects/:id`                                  | Accepts new optional `hourlyRateCents` field. |
| DELETE | `/invoices/:id`                                  | Existing endpoint additionally nulls `invoiceLineItemId` on all linked time entries (single transaction). |

## UI Surfaces

### Persistent timer widget (top bar of dashboard layout)

- Renders only for `owner`/`admin`. Polls `/time-entries/running` every 30s plus on focus.
- Two states:
  - **Idle:** "Start timer" button → opens a small popover (project picker + optional task picker + description input + Start button).
  - **Running:** colored chip showing project name, live ticking duration (`mm:ss` < 1h, `h:mm:ss` else), and a Stop button. Click chip → jump to the project's Time tab.

### Project page → new "Time" tab

- Sits next to existing tabs (Files / Tasks / Updates / Time).
- Top: totals (this week / this month / all-time), with billable vs non-billable split.
- Buttons: **Start timer** (pre-fills the project) and **Add manual entry** (opens a modal).
- Below: paginated entry list (date, user, task, description, duration, billable badge, invoiced badge, edit/delete icons that grey out for invoiced rows).

### Reports page `/dashboard/reports/time`

- New sidebar entry "Reports" with sub-link "Time".
- Filters: project (multi), user (multi), date range, billable (all/yes/no), invoiced (all/yes/no).
- Summary cards: total hours, billable hours, total value (cents formatted as currency).
- Two grouped tables: by project and by user. Sortable.
- "Export CSV" button.

### Invoices page → new "Generate from time" entry point

- New button next to "New invoice" → opens wizard:
  1. Pick project (required) and optional date range.
  2. Toggle "Include non-billable" (default off).
  3. Preview list of eligible entries grouped by task.
  4. **Generate draft** → creates the invoice and routes to its detail page.

### Team page → default hourly rate field

- Owner-only. Inline editable cell next to each staff member's role. Empty = no default.

### Project settings → project rate override

- New "Time tracking" section: project-level rate input (empty = use member default).

## Auth, Roles, Errors

- All endpoints under `/time-entries/*` are gated by `@Roles("owner", "admin")`. The existing `RolesGuard` returns 403 on member.
- Tenancy: every query filters on `organizationId` from `@CurrentOrg`. Cross-org access returns 404 (consistent with existing patterns).
- Mutating an invoiced entry: `409 Conflict { code: "ENTRY_LOCKED" }`.
- Starting a new timer with a stale running timer: server auto-stops the stale one and starts the new one in one transaction; client just sees the new running entry returned.

## Generate-from-time semantics (locked)

- Eligible entries: same `organizationId` + `projectId`, `endedAt IS NOT NULL`, `invoiceLineItemId IS NULL`, and `billable = true` unless `includeNonBillable: true`.
- Optional `from` / `to` filter on `startedAt`.
- One line item per entry. Mapping:
  - `description`: `entry.description ?? (taskTitle ?? "Time entry")` + ` — ${formatDate(entry.startedAt)}`
  - `quantity`: `Math.round((durationSec / 3600) * 4) / 4` rounded to 0.25 — stored as a string with two decimals (the schema currently stores qty as int — see "Schema constraint" below)
  - `unitPrice`: `entry.hourlyRateCents ?? 0`
- Created invoice has status `draft` and the org's existing default currency.
- Transactional: invoice + all line items + entry FK updates happen in a single Prisma `$transaction`.

### Schema constraint to resolve in plan

The existing `InvoiceLineItem.quantity` is `Int`. We have two options:

- **A.** Migrate `quantity` to `Decimal` (exact 0.25 increments).
- **B.** Multiply quantity by 100 and store hundredths-of-an-hour, divide for display.

The plan picks **A** (migrate `Int → Decimal` with `bun db:push --accept-data-loss=false` — Prisma handles this as a type widening, no data loss for whole-number rows). Existing UI just reads the number.

## Reports semantics

- The aggregate response shape:

  ```ts
  {
    totals: { seconds: number; billableSeconds: number; valueCents: number };
    byProject: Array<{ projectId: string; projectName: string; seconds: number; billableSeconds: number; valueCents: number }>;
    byUser:    Array<{ userId: string; name: string; seconds: number; billableSeconds: number; valueCents: number }>;
  }
  ```

- `valueCents` = sum over entries of `(durationSec / 3600) * (hourlyRateCents ?? 0)` for billable entries only.

## Migration / Rollout

- `bun db:push` adds the new model, the new columns, and the InvoiceLineItem.quantity Decimal widening. No data migration required (everyone starts with no entries; default rates remain null until a user sets them).
- Feature is invisible until a user starts tracking. No flag-gating.

## Testing

### Unit (Bun, `*.spec.ts`)

- `TimeEntriesService`:
  - `start` auto-stops a previous running entry.
  - `stop` returns 404 if no running entry.
  - `create` (manual) computes durationSec from start/end.
  - `update` and `delete` return 409 when entry is invoiced.
  - `report` math: 1h billable + 30min non-billable at $50/hr → `{ seconds: 5400, billableSeconds: 3600, valueCents: 5000 }`.
  - `generateInvoice` rejects when no eligible entries.
  - `generateInvoice` skips already-invoiced entries.
  - `generateInvoice` snapshots the entry's `hourlyRateCents` into `unitPrice`.
  - Cross-org access returns 404.

### E2E (Playwright, `e2e/tests/time-tracking.e2e.ts`)

- Start timer from project Time tab → see running chip in top bar → stop → entry appears with computed duration.
- Manual entry: open modal, set start/end, save, see in list.
- Generate invoice from time: 2 billable entries → wizard preview shows both → create draft → invoice exists with 2 line items → both entries marked invoiced.
- Re-running the wizard for the same project shows "no eligible entries".
- Client (member) hitting `/api/time-entries` returns 403.
- Reports page filters by project and exports CSV.

## Open Questions

None at design freeze. Anything that surfaces during plan-writing or implementation goes in the plan, not this spec.
