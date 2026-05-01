# View as Customer — Design

## Background

GitHub issue [#42](https://github.com/Vibra-Labs/Atrium/issues/42) requests a "View as customer" affordance so an agency owner or admin can preview the portal experience for a specific client. Today, the only way to see what a client sees is to log in as that client (which requires their credentials and breaks audit trails). New users especially want to verify what their clients will see before inviting them.

## Goals

- Owners and admins can launch a read-only preview of the portal scoped to a specific client's data.
- The preview faithfully renders the portal layout, navigation, and project visibility for that client.
- Mutations (signing documents, posting comments, etc.) are blocked during the preview to avoid accidentally acting on the client's behalf.
- No new credentials, tokens, or session swaps are issued — the requester remains authenticated as themselves.

## Non-goals

- Full impersonation (acquiring a session as the client). This is out of scope due to the audit-trail and footgun risks.
- Previewing as a team member (admin/owner). Only `member`-role users (clients) can be previewed.
- Persisting preview state across browser sessions or sharing preview URLs with others.

## User flow

1. Owner navigates to `/dashboard/clients`, opens the **Clients** tab.
2. Each client row shows a **View as customer** icon button (Lucide `Eye`).
3. Clicking the button opens `/portal?previewAs=<clientUserId>` in a new tab.
4. The portal renders normally, scoped to that client's data, with a sticky banner at the top: *"Previewing as Ben Carter — read-only · Exit preview"*.
5. Mutation buttons in the portal (sign document, etc.) are disabled with tooltip *"Disabled in preview mode"*.
6. Clicking **Exit preview** closes the tab (with `router.push("/dashboard/clients")` as fallback).

## Architecture

### Server side (`apps/api`)

**`apps/api/src/auth/preview-mode.middleware.ts`** — new

- Reads `X-Preview-As` header from incoming requests.
- If absent: passes through unchanged.
- If present:
  - Validates the requester's role in the active org is `owner` or `admin`. If not, responds 401.
  - Validates the target user exists, is a `member` in the same org. If not, responds 401.
  - Overrides `req.user.id = <targetUserId>` and sets `req.previewMode = true`.

**`apps/api/src/auth/preview-mode.guard.ts`** — new

- Registered globally via `APP_GUARD`.
- If `req.previewMode === true` and request method is not `GET` or `HEAD`, throws `ForbiddenException("Read-only preview mode")`.
- Otherwise allows the request to proceed (downstream guards still apply).

**`apps/api/src/app.module.ts`** — modified

- Apply `PreviewModeMiddleware` after the existing `SessionMiddleware` so `req.user` is populated first.
- Register `PreviewModeGuard` with `APP_GUARD` provider.

The middleware works because all client-scoped controllers already read the user id from `@CurrentUser("id")`. By substituting `req.user.id` upstream, every existing endpoint (e.g., `/projects/mine`, `/projects/mine/:id`, file downloads, updates) returns the target client's data without per-controller changes.

### Client side (`apps/web`)

**`apps/web/src/lib/preview-mode.tsx`** — new

- Exports `PreviewModeProvider` and `usePreviewMode()` hook.
- On mount, reads `previewAs` query param. If present:
  - Fetches `/clients/<id>/profile` to get the client's name/email for the banner.
  - Stores `{ clientId, clientName, clientEmail }` in React context and `sessionStorage` under key `atrium:previewAs`.
  - Calls `router.replace("/portal")` to remove the query param from the URL.
- On subsequent mounts, hydrates from `sessionStorage` if present.
- Exposes `exitPreview()` which clears state and attempts `window.close()` with `router.push("/dashboard/clients")` fallback.

**`apps/web/src/lib/api.ts`** — modified

- Reads `atrium:previewAs` from `sessionStorage` on each call.
- If present:
  - Attaches `X-Preview-As: <clientId>` header to the request.
  - For non-`GET`/`HEAD` requests, short-circuits with a thrown `Error("Read-only preview")` before hitting the network. (Defense-in-depth — the server will also reject.)

**`apps/web/src/app/(portal)/layout.tsx`** — modified

- Wrap the portal subtree with `PreviewModeProvider`.
- Render `<PreviewBanner />` immediately above the existing portal content.

**`apps/web/src/components/preview-banner.tsx`** — new

- Sticky banner at the top of the viewport, amber background, full width.
- Shows "Previewing as {clientName} — read-only".
- Right side: "Exit preview" button calling `exitPreview()`.
- Hidden when `usePreviewMode()` returns null.

**`apps/web/src/app/(dashboard)/dashboard/clients/page.tsx`** — modified

- In the clients list (the `clients.map(...)` block), add an `<Eye />` icon button to each client row, positioned alongside the existing reset-password and remove buttons.
- Visible only when `currentRole === "owner" || currentRole === "admin"`.
- onClick: `window.open(\`/portal?previewAs=${member.userId}\`, "_blank")`.
- Tooltip: "View as customer".

### Mutation UX in portal pages

Existing portal components that perform mutations should consult `usePreviewMode()` and disable their action buttons when preview is active. At minimum:

- `apps/web/src/app/(portal)/portal/projects/[id]/components/portal-invoices-section.tsx` (any pay/accept actions)
- `apps/web/src/app/(portal)/portal/sign/[token]/page.tsx` (sign button)
- Any update/comment composer in portal project detail pages

If a mutation slips through, the server still rejects it with 403, and the toast layer surfaces the error. The disabled state is a UX nicety, not a security boundary.

## Data flow

1. Owner clicks **View as customer** on Ben's row → new tab opens at `/portal?previewAs=<benUserId>`.
2. `PreviewModeProvider` mounts, fetches Ben's profile (with `X-Preview-As` header set), stores `{ clientId: benUserId, clientName: "Ben Carter", ... }`, and replaces the URL with `/portal`.
3. The portal layout renders. `<PreviewBanner />` shows "Previewing as Ben Carter — read-only".
4. The portal pages call `/projects/mine`, `/projects/mine/:id`, etc. via `apiFetch`. Each request now carries `X-Preview-As: <benUserId>`.
5. `PreviewModeMiddleware` validates owner/admin role + target membership, sets `req.user.id = benUserId`, sets `req.previewMode = true`.
6. `PreviewModeGuard` allows GET requests through; controllers return Ben's data scope.
7. Owner clicks **Exit preview** → state cleared → tab closes (or routes back to dashboard).

## Error handling

| Scenario | Behavior |
|---|---|
| Requester is a `member` (not owner/admin) | Middleware returns 401. Front-end shows toast "Preview unavailable", routes to `/dashboard/clients`. |
| Target user is in a different org or is owner/admin | Middleware returns 401. Same handling. |
| Target user has been deleted mid-preview | Next API call returns 401. Banner stays; user clicks Exit. |
| `X-Preview-As` header is malformed | Middleware ignores the header, request proceeds as the actual user. Banner won't render because context never initialized successfully. |
| Mutation attempted in preview mode | Client `apiFetch` short-circuits with `Error("Read-only preview")`. If it bypasses, server returns 403 `"Read-only preview mode"`. |
| `window.close()` blocked by browser | `exitPreview()` falls back to `router.push("/dashboard/clients")`. |

## Testing

**Unit (Bun, `apps/api/src/**/*.spec.ts`):**

- `preview-mode.middleware.spec.ts`
  - Owner with valid client target → `req.user.id` overridden, `req.previewMode = true`.
  - Admin with valid client target → same.
  - Member trying to preview → 401.
  - Target in a different org → 401.
  - Target is owner/admin (not a client) → 401.
  - Missing header → passes through, no override.
- `preview-mode.guard.spec.ts`
  - GET with `previewMode = true` → allowed.
  - POST/PUT/PATCH/DELETE with `previewMode = true` → 403.
  - POST without `previewMode` → allowed.

**E2E (Playwright, `e2e/tests/`):**

- `preview-as-client.e2e.ts`
  - Owner logs in, creates a project assigned to client A, creates a second project assigned only to client B.
  - Owner navigates to `/dashboard/clients`, clicks **View as customer** on client A.
  - New tab opens; portal lists client A's project but not client B's.
  - Banner is visible with client A's name.
  - Attempting a mutation (e.g., updating profile via the portal settings page) is blocked / button is disabled.
  - Clicking **Exit preview** returns to the dashboard.

## Rollout

This is purely additive — no schema changes, no breaking API changes. Behind no feature flag; ships as a normal feature.
