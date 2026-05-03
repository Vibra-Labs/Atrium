# Calendar View — Design Spec

**Date:** 2026-05-01
**Scope:** Read-only calendar that aggregates existing dated entities (tasks, projects, invoices) onto a month grid and an agenda list.
**Out of scope:** New Event/Meeting entity, recurrence, attendee invites, ICS feed, portal-side calendar, time-entry surfacing.

---

## Goal

Give agency users a single place to see what's due and what's happening across all projects without clicking into each one. The calendar reads existing data — it does not introduce a new entity.

## Architecture

A single dashboard page at `/dashboard/calendar` calls one new API endpoint that returns a unified, typed event list. The page renders either a month grid or an agenda list, with client-side filters layered on top of the fetched data.

```
GET /calendar?from&to&projectId?&type?
   └─ CalendarService.list(orgId, range, filters)
       ├─ prisma.task.findMany     (where dueDate in range)
       ├─ prisma.project.findMany  (where startDate or endDate in range)
       └─ prisma.invoice.findMany  (where dueDate in range, project in org)
   ↓
CalendarEvent[] discriminated union
   ↓
<CalendarPage> → <MonthGrid> | <AgendaList>
```

## API

### `GET /calendar`

**Auth:** `owner` or `admin` (RolesGuard).

**Query:**
- `from` (ISO date, required) — inclusive start of window
- `to` (ISO date, required) — inclusive end of window
- `projectId` (string, optional) — filter to one project
- `type` (string, optional) — comma-separated subset of `task,project_start,project_end,invoice_due`

**Validation:** `to` must be > `from`; window capped at 366 days (BadRequest if exceeded). Both dates required.

**Response:** `CalendarEvent[]`, sorted ascending by `date`.

```ts
type CalendarEvent =
  | {
      type: "task";
      id: string;            // task id
      date: string;          // ISO date (yyyy-mm-dd)
      title: string;         // task.title
      status: string;        // task.status
      projectId: string;
      projectName: string;
      assigneeId: string | null;
      assigneeName: string | null;
    }
  | {
      type: "project_start" | "project_end";
      id: string;            // project id (suffix in DOM keys to disambiguate)
      date: string;
      title: string;         // project.name
      projectId: string;
      projectName: string;
    }
  | {
      type: "invoice_due";
      id: string;            // invoice id
      date: string;
      title: string;         // invoice.invoiceNumber
      status: string;        // "draft" | "sent" | "paid" | "overdue"
      projectId: string | null;
      projectName: string | null;
      amountCents: number;   // computed from line items or invoice.amount
    };
```

The DOM key for project events uses `${projectId}-start` / `${projectId}-end` to avoid collisions when both fall in the same window.

## Service

`apps/api/src/calendar/calendar.service.ts` — `CalendarService.list(orgId, query)`:

1. Parse and validate range. Throw `BadRequestException` if `to <= from` or window > 366 days.
2. Resolve which entity types to include from `query.type` (default: all four).
3. Run the relevant Prisma queries in parallel under `Promise.all`. Each query is org-scoped via `organizationId`.
4. Map each result to a `CalendarEvent` shape. Truncate dates to `yyyy-mm-dd` strings.
5. Concatenate, sort by date ascending, return.

Invoice amount is computed as `amount ?? sum(lineItems.unitPrice * quantity)`. Read with `include: { lineItems: { select: { quantity: true, unitPrice: true } } }`.

## Controller

`apps/api/src/calendar/calendar.controller.ts` — `@Controller("calendar")` with `@UseGuards(AuthGuard, RolesGuard)` and `@Roles("owner", "admin")`. One method:

```ts
@Get()
list(@CurrentOrg("id") orgId: string, @Query() q: CalendarQueryDto) {
  return this.service.list(orgId, q);
}
```

`CalendarQueryDto` validates `from`/`to` as `@IsDateString`, `projectId` as `@IsOptional @IsString`, `type` as `@IsOptional @IsString` (comma-split happens in the service).

Module: `CalendarModule` registered in `app.module.ts` alongside `TimeEntriesModule`.

## Web — Page Layout

Path: `apps/web/src/app/(dashboard)/dashboard/calendar/page.tsx` (client component).

```
┌──────────────────────────────────────────────────────────┐
│ Calendar                       [Month] [Agenda]   ← view │
│ ◀ May 2026 ▶                                             │
│ Project: [All ▾]  Type: [✓ Tasks ✓ Projects ✓ Invoices] │
│ Assignee: [All ▾]                                         │
├──────────────────────────────────────────────────────────┤
│  Sun  Mon  Tue  Wed  Thu  Fri  Sat                       │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐                    │
│  │  │ │  │ │  │ │● │ │  │ │  │ │  │   ← chips per day  │
│  │  │ │  │ │  │ │  │ │  │ │  │ │  │                     │
│  └──┘ └──┘ └──┘ └──┘ └──┘ └──┘ └──┘                    │
│  ...                                                     │
└──────────────────────────────────────────────────────────┘
```

### Month grid

- Header bar: previous/next month buttons, current month label, "Today" jump button, view toggle (Month/Agenda).
- Filter row beneath header: project picker, three entity-type toggles, assignee picker (only enabled when "Tasks" toggle is on).
- 7-column grid of day cells covering the month; the grid pads with leading and trailing days from adjacent months (rendered dimmer).
- Each cell shows up to 3 chips. If a day has more, render a "+N more" link that opens an agenda-style popover for that day.
- Chips are color-coded by type:
  - Task: status color (existing palette in the task badge component).
  - Project start: blue-tinted.
  - Project end: purple-tinted.
  - Invoice due: amber for draft/sent, red for overdue, green for paid.
- Today's cell has a primary-colored ring.

### Agenda view

- Flat list of events in the selected window, grouped by date (sticky date headers), one row per event with type icon, title, project, and a state pill.
- Same filter row as month view.

### Interaction

- Click a task chip → push to `/dashboard/projects/{projectId}?tab=tasks&task={taskId}` (the project page already supports `?task=` deep-linking).
- Click a project chip → push to `/dashboard/projects/{projectId}`.
- Click an invoice chip → push to `/dashboard/projects/{projectId}?tab=invoices`.

### Filters

- All filters are client-side over the fetched event list except `projectId`, which is sent to the API to keep the payload small when one project is selected.
- Type toggles default to all on.
- Assignee picker is sourced from the union of assignees in the loaded events plus a dynamic fetch of org members (lazy-fetched on first open). Defaults to "All".

### State

- `month` (Date) — controls fetch window (`startOf(month) - leadingDays` to `endOf(month) + trailingDays`).
- `view` ("month" | "agenda").
- `projectId`, `typeFilter` (Set), `assigneeId`.
- `events` (CalendarEvent[]), `loading`, `error`.
- Refetch when `month` or `projectId` changes (server-side filters). Other filters are pure client-side.

### Sidebar nav

Add `{ href: "/dashboard/calendar", label: "Calendar", icon: Calendar }` from lucide-react, positioned between Projects and Reports.

## Error handling

- API: BadRequest on invalid range; 401/403 from existing guards.
- Web: error toast on fetch failure; show a centered "Failed to load — retry" with a retry button if the request errors.
- Empty state: "No items in this window" inside the agenda view; an empty month grid is fine on its own.

## Testing

### Unit (apps/api)

`calendar.service.spec.ts` — uses the existing live-Postgres fixture pattern (org/user/project per test):

1. Returns task whose `dueDate` falls in window; excludes one outside window.
2. Returns project_start and project_end events for projects with `startDate`/`endDate` in window; omits when `null`.
3. Returns invoice with computed amount from line items; omits invoices outside window.
4. `projectId` filter narrows tasks, projects, and invoices to that project.
5. `type` filter narrows the union (e.g. `type=task` returns only task events).
6. Throws BadRequestException when `to <= from`.
7. Throws BadRequestException when window > 366 days.
8. Sort order is ascending by date across all event types.

### E2E (`e2e/tests/calendar.e2e.ts`)

Adopt the same pattern as `time-tracking.e2e.ts` (reusable project, telemetry banner dismissal, login helper):

1. **Month grid renders task on its due date.** Seed a task via API with a `dueDate` in the visible month. Navigate to `/dashboard/calendar`. Assert the task title is visible inside the cell for that date.
2. **Project filter narrows the grid.** Seed two tasks on different projects. Apply project filter to one. Assert only that task remains visible.
3. **Click task chip navigates to project task deep link.** Click the chip; assert URL matches `/dashboard/projects/{id}?tab=tasks&task={taskId}`.
4. **Agenda view lists future items grouped by date.** Toggle to Agenda. Assert at least one date header and one event row are visible.

## File structure

**API:**
- Create `apps/api/src/calendar/calendar.module.ts`
- Create `apps/api/src/calendar/calendar.controller.ts`
- Create `apps/api/src/calendar/calendar.service.ts`
- Create `apps/api/src/calendar/calendar.dto.ts`
- Create `apps/api/src/calendar/calendar.service.spec.ts`
- Modify `apps/api/src/app.module.ts` (register module)

**Web:**
- Create `apps/web/src/app/(dashboard)/dashboard/calendar/page.tsx`
- Create `apps/web/src/app/(dashboard)/dashboard/calendar/month-grid.tsx`
- Create `apps/web/src/app/(dashboard)/dashboard/calendar/agenda-list.tsx`
- Create `apps/web/src/app/(dashboard)/dashboard/calendar/event-chip.tsx`
- Create `apps/web/src/app/(dashboard)/dashboard/calendar/types.ts` (the `CalendarEvent` discriminated union)
- Modify `apps/web/src/app/(dashboard)/sidebar-nav.tsx` (add Calendar link)

**E2E:**
- Create `e2e/tests/calendar.e2e.ts`

No schema changes. No new dependencies — date math handled with native `Date` plus a few helper functions in `types.ts` (or a small `date-utils.ts` if it grows).

## YAGNI exclusions

Explicitly out of this spec to keep scope honest:
- Drag-to-reschedule (would require write endpoints and per-entity update calls).
- Recurring events (no new entity, no recurrence).
- Time-of-day rendering — month grid only shows whole days.
- ICS / external calendar sync.
- Portal-side calendar — clients see only their projects today; revisit if asked.
- Past-N-months performance tuning — the 366-day cap is plenty for a hand-navigated calendar.
