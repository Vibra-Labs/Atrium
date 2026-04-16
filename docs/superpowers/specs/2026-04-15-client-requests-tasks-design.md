# Client Requests & Task Evolution Design

**Date:** 2026-04-15  
**Status:** Approved

## Problem

Atrium's current task system is agency-driven. Clients can only respond to tasks the agency creates (checkbox completion, voting on decisions). For long-term contracts, clients need a way to submit their own requests to the agency — e.g., "update the homepage copy," "fix this bug." Tasks and client requests should be a single unified concept, not two separate systems.

## Goals

- Clients can create requests from the portal
- Both sides see a shared task list with clear ownership and status
- Richer status workflow replaces the binary `completed` flag
- Agency can assign tasks to team members
- Notifications are sent on assignment, status changes, new client requests, and new comments from the other side

## Out of Scope

- Assignment UI is wired up but not a focus for this release (field exists, notifications fire, but no dedicated assignment view)
- Kanban / board view
- Client-created decision tasks

---

## Data Model Changes

### `Task` table

**Add:**
- `status String @default("open")` — replaces `completed`. Values: `open` | `in_progress` | `done` | `cancelled`
- `requestedById String?` — user ID of whoever created the task (agency member or client). Populated on create.
- `assigneeId String?` — nullable user ID of the agency member assigned to this task.

**Remove:**
- `completed Boolean` — migrated: `true` → `done`, `false` → `open`

**Unchanged:**
- `closedAt DateTime?` — only set on `type = "decision"` tasks when voting is closed. This is unrelated to task `status` and stays as-is.

**Migration strategy:**
1. Add `status`, `requestedById`, `assigneeId` columns with defaults
2. Backfill: `UPDATE task SET status = CASE WHEN completed = true THEN 'done' ELSE 'open' END`
3. Drop `completed` column
4. All code referencing `task.completed` switches to `task.status === 'done'`
5. `requestedById` is null for pre-existing tasks — treated as agency-created

### No new tables needed

Notifications use the existing `Notification` + `PushSubscription` models.

---

## Portal (Client) Side

### Creating a request

- A **"New Request"** button appears in the Tasks tab (mirroring the "Add Update" button in the Updates tab)
- Opens a modal with: Title (required), Description (optional), Due Date (optional)
- On submit: creates a `Task` with `type = "checkbox"`, `status = "open"`, `requestedById = currentUser.id`
- Decision tasks cannot be created by clients

### Task list rendering

- Each task shows a **status badge**: `Open` (gray) / `In Progress` (blue) / `Done` (green) / `Cancelled` (muted)
- Tasks with `requestedById = currentUser.id` show a **"Your request"** tag
- Clients cannot change the status (read-only badges for them)
- Clients can cancel their own `open` requests (sets status to `cancelled`)
- Voting, comments, and due dates render as they do today

---

## Dashboard (Agency) Side

### Task list changes

- **Status filter bar** — filter by `open` / `in_progress` / `done` / `cancelled`. Default: open + in_progress visible.
- **Status dropdown** on each task — agency can move tasks through the workflow. Saving triggers status-change notifications.
- **Assignee picker** on each task — dropdown of org members. Saving triggers assignment notification.
- **"Client Request" badge** — visual tag on tasks where `requestedById` is a portal client (not a member).
- Existing create-task flow unchanged (all task types still available).
- Existing drag-to-reorder and decision close behavior unchanged.

---

## Notifications

All notifications use the existing `Notification` model and VAPID push infrastructure.

| Trigger | Who gets notified | Message |
|---|---|---|
| Client creates a request | All org `owner` + `admin` members | "[Client name] submitted a new request: [title]" |
| `assigneeId` set or changed | New assignee (agency member) | "You've been assigned: [title]" |
| Status changes | `requestedById` user + current `assigneeId` | "[title] is now [status]" |
| Comment added | The other side's primary actor (requester if agency comments, assignee+owners if client comments) | "[Name] commented on [title]" |

Push notifications fire for all four triggers alongside in-app notifications.

---

## API Changes

### Tasks controller — new/changed endpoints

| Method | Path | Who | Change |
|---|---|---|---|
| `POST` | `/tasks?projectId=` | Agency + Client | Accept `requestedById`; clients can only create `type=checkbox` |
| `PATCH` | `/tasks/:id` | Agency only | Add `status`, `assigneeId` fields; fire notifications on change |
| `PATCH` | `/tasks/:id/cancel` | Client (own requests only) | Sets `status = cancelled` |
| `GET` | `/tasks/mine/:projectId` | Client | Returns `status` field instead of `completed` |
| `GET` | `/tasks/:projectId` | Agency | Add `status` filter query param |

### Removed
- Any dedicated complete/toggle endpoint — superseded by `PATCH /tasks/:id` with `{ status: "done" }`

---

## Testing

E2E tests (Playwright) covering:
- Client creates a request → appears in portal task list and dashboard with "Client Request" badge
- Agency changes status → client sees updated badge; notification sent
- Agency assigns task → assignee receives notification
- Client cancels their own open request → status becomes cancelled
- Client cannot change status of agency-created tasks
- Comment on a task notifies the other side
