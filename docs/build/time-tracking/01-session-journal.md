# 01 — Session Journal

## What

Adds a timer-bound Session Journal to time tracking: notes and task completions are captured into the running timer, while task completions without a timer become pending captures that can be resolved into real time entries.

## Why

Chris wants the Pexlo Portal timer to double as a work journal for billing and R&D substantiation. The operating rule is: work should happen with a timer running; if a task is completed without one, the product should ask how long it took instead of losing the work signal.

## Considered & Rejected

- **Client-side double-write when completing a task:** rejected because it can create duplicate journal lines. The UI completes the task only; server-side task hooks perform journal capture.
- **Auto-expiring pending captures:** rejected because no-timer completions are billing-relevant until explicitly resolved.
- **Mutating existing time-entry/task schema:** rejected. The migration is additive-only with two new tables and back-relations in Prisma.
- **Creating back-filled running timers:** rejected. Pending capture resolution always writes `endedAt` and `durationSec`, so it cannot collide with the out-of-band one-running-timer partial unique index.

## What We Built

### Database

Files:

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20260601225000_add_session_journal/migration.sql`

New tables:

- `time_entry_log` — notes/progress/task completion lines for a time entry.
- `pending_time_capture` — unresolved task completions that happened without a running timer.

Back-relations added:

- `TimeEntry.logs`
- `Task.timeLogs`
- `Task.pendingCaptures`
- `Project.pendingCaptures`

### API and capture hooks

Files:

- `apps/api/src/time-entries/time-entry-capture.service.ts`
- `apps/api/src/time-entries/time-entry-capture.service.spec.ts`
- `apps/api/src/time-entries/time-entries.controller.ts`
- `apps/api/src/time-entries/time-entries.service.ts`
- `apps/api/src/time-entries/time-entries.dto.ts`
- `apps/api/src/tasks/tasks.service.ts`
- `apps/api/src/tasks/tasks.controller.ts`
- `apps/api/src/tasks/tasks.module.ts`
- `apps/api/src/agent/agent-tasks.service.ts`
- `apps/api/src/agent/agent.module.ts`

Capture behavior:

1. On transition to `status: "done"`, human and agent task paths call `TimeEntryCaptureService.captureTaskCompletion`.
2. The service looks for a running `TimeEntry` scoped to organization + project.
3. If found, it writes a `task_done` row to `time_entry_log`.
4. If none is found, it writes a `pending_time_capture` row.
5. The capture service wraps the whole operation in `try/catch`; task completion is best-effort and never fails because journaling failed.
6. Agent capture uses the resolved API key organization (`apiKey.organizationId`), never a client-supplied org id.

New endpoints, guarded with the existing owner/admin roles:

- `POST /time-entries/:id/logs`
- `GET /time-entries/:id/logs`
- `DELETE /time-entries/logs/:logId`
- `GET /time-entries/running` now includes `logs`
- `GET /time-entries/pending-captures`
- `POST /time-entries/pending-captures/:id/resolve`

Immutability rule:

- Adding/deleting logs is rejected if the parent time entry has `invoiceLineItemId != null`.

Pending capture resolution:

- Validates unresolved org-scoped capture.
- Creates a real `TimeEntry` with `endedAt` set to the task completion time and `startedAt = endedAt - durationSec`.
- Uses the existing rate backfill logic (`resolveRate`).
- Adds a `task_done` log to the created entry.
- Sets `resolvedAt` and `resolvedTimeEntryId`.

### Web UI

File:

- `apps/web/src/app/(dashboard)/dashboard/projects/[id]/time-tab.tsx`

Added:

- Session Journal panel while a timer runs.
- Quick-add note input.
- Live journal list with relative timestamps and delete for user note/progress lines.
- “Log completed task” selector that completes the task via the existing task endpoint and relies on server capture for the journal line.
- Stop timer modal journal summary with “Use journal as description”.
- Pending capture banner/list with resolve modal.
- Resolve chips: 15m, 30m, 1h, 2h, custom minutes, plus billable toggle.

## How to Extend

- Add new journal kinds by extending `CreateTimeEntryLogDto` validation and the UI label rendering.
- If multiple concurrent timers per project become common, refine the capture lookup to prefer the actor's running timer when actor identity maps cleanly to a user; today it follows the brief's org+project running timer lookup.
- If pending captures need assignment, add a resolver/owner field to `pending_time_capture` rather than overloading `completedByName`.
- If journal text should feed invoices more structurally, keep the raw logs and generate invoice descriptions at invoice time rather than denormalizing into `TimeEntry.description` automatically.

## Verification

### Prisma generate

```text
Prisma schema loaded from prisma/schema.prisma
✔ Generated Prisma Client (v6.19.2) to ./../../node_modules/.bun/@prisma+client@6.19.2/node_modules/@prisma/client in 159ms
```

### Additive-only migration diff

Command compared `origin/main:packages/database/prisma/schema.prisma` to the new schema.

```sql
-- CreateTable
CREATE TABLE "time_entry_log" (
    "id" TEXT NOT NULL,
    "timeEntryId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "text" VARCHAR(1000) NOT NULL,
    "taskId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_entry_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_time_capture" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'task_done',
    "label" TEXT NOT NULL,
    "completedByType" TEXT NOT NULL DEFAULT 'agent',
    "completedByName" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedTimeEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_time_capture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_entry_log_timeEntryId_createdAt_idx" ON "time_entry_log"("timeEntryId", "createdAt");

-- CreateIndex
CREATE INDEX "time_entry_log_organizationId_idx" ON "time_entry_log"("organizationId");

-- CreateIndex
CREATE INDEX "time_entry_log_taskId_idx" ON "time_entry_log"("taskId");

-- CreateIndex
CREATE INDEX "pending_time_capture_organizationId_resolvedAt_idx" ON "pending_time_capture"("organizationId", "resolvedAt");

-- CreateIndex
CREATE INDEX "pending_time_capture_projectId_resolvedAt_idx" ON "pending_time_capture"("projectId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "time_entry_log" ADD CONSTRAINT "time_entry_log_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "time_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry_log" ADD CONSTRAINT "time_entry_log_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_time_capture" ADD CONSTRAINT "pending_time_capture_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_time_capture" ADD CONSTRAINT "pending_time_capture_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

No `ALTER TABLE` or `DROP` on existing tables appears in the diff; the only `ALTER TABLE` statements add foreign keys to the two new tables.

### Migration status against isolated test DB

```text
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "neondb", schema "public" at "ep-wispy-darkness-aqghbc0b-pooler.c-8.us-east-1.aws.neon.tech"

9 migrations found in prisma/migrations
Following migration have not yet been applied:
20260601225000_add_session_journal

To apply migrations in development run prisma migrate dev.
To apply migrations in production run prisma migrate deploy.
```

### API typecheck

```text
API_TSC_EXIT=0
```

### Web typecheck

```text
WEB_TSC_EXIT=0
```

### Focused capture-service spec via isolated test path

The worktree did not contain `packages/database/.env.test`, so the command sourced the existing Pexlo Portal test env from the main checkout. The package test script still performed its safety preflight and forced `DATABASE_URL=$TEST_DATABASE_URL`.

```text
✅ Test DB target: postgresql://neondb_owner:****@ep-wispy-darkness-aqghbc0b-pooler.c-8.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require
✅ Pre-flight passed. Tests may proceed.
bun test v1.3.14 (0d9b296a)

src/time-entries/time-entry-capture.service.spec.ts:
✅ Bun test DB target: postgresql://neondb_owner:****@ep-wispy-darkness-aqghbc0b-pooler.c-8.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require
(pass) TimeEntryCaptureService > writes a task_done log when a timer is running on the project [0.32ms]
(pass) TimeEntryCaptureService > creates a pending capture when no timer is running [0.06ms]
(pass) TimeEntryCaptureService > swallows capture failures so task completion is best-effort [0.12ms]

 3 pass
 0 fail
 7 expect() calls
Ran 3 tests across 1 file. [101.00ms]
```

### Existing tasks-service spec after constructor DI update

`@atrium/email` was built first because that workspace package exposes `dist/index.js` as its runtime `main`.

```text
src/tasks/tasks.service.spec.ts:
✅ Bun test DB target: postgresql://neondb_owner:****@ep-wispy-darkness-aqghbc0b-pooler.c-8.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require
(pass) TasksService > createForClient > creates a task with status=open and requestedById set to caller [0.60ms]
(pass) TasksService > createForClient > throws ForbiddenException if client is not assigned to the project [0.89ms]
(pass) TasksService > create > creates a task with requestedById=null when no requestedById arg is passed [0.36ms]
(pass) TasksService > findByProject > returns only open and in_progress tasks when status=active [0.58ms]
(pass) TasksService > findByProject > returns only done tasks when status=done [0.17ms]
(pass) TasksService > findByProject > returns all tasks when status=all [0.06ms]
(pass) TasksService > findByProject > returns all tasks when status is undefined [0.05ms]
(pass) TasksService > findByProject > sets isClientRequest=true when requestedById is a non-member [0.12ms]
(pass) TasksService > findByProject > sets isClientRequest=false when requestedById is an org member [0.10ms]
(pass) TasksService > findByProject > sets isClientRequest=false when requestedById is null [0.06ms]
(pass) TasksService > update — assigneeId validation and notifications > throws BadRequestException when assigneeId is not an org member [0.38ms]
(pass) TasksService > update — assigneeId validation and notifications > restricts assigneeId to owner/admin roles (not member) [6.73ms]
(pass) TasksService > update — assigneeId validation and notifications > accepts a valid assigneeId that is an org member [0.17ms]
(pass) TasksService > update — assigneeId validation and notifications > fires notifyTaskAssigned when assignee changes [0.06ms]
(pass) TasksService > update — assigneeId validation and notifications > does NOT fire notifyTaskAssigned when same assignee is set again [0.05ms]
(pass) TasksService > update — assigneeId validation and notifications > fires notifyTaskStatusChanged when status changes [0.05ms]
(pass) TasksService > update — assigneeId validation and notifications > does NOT fire notifyTaskStatusChanged when status is unchanged [0.05ms]
(pass) TasksService > cancelClientTask > cancels an open task when the requester calls it [0.15ms]
(pass) TasksService > cancelClientTask > throws ForbiddenException if a different user tries to cancel [0.08ms]
(pass) TasksService > cancelClientTask > throws BadRequestException if task is not open [0.07ms]

 20 pass
 0 fail
 26 expect() calls
Ran 20 tests across 1 file. [714.00ms]
```

## Known Gaps / Deferred

- No browser screenshot was captured in this build session; verification is typecheck/spec/diff-level plus UI code inspection.
- The test `.env.test` was not present in this worktree, but the existing isolated Pexlo Portal test env in the main checkout was used for the package preflight.
- The UI refreshes journal state after mutations rather than streaming live updates.
- Pending captures are shown on the project Time tab only; a dashboard-level aggregate can be added later.

## References

- Brief: `/Users/bizman247/.openclaw/workspace/briefs/pexlo-session-journal-brief.md`
- Branch: `feat/session-journal`
