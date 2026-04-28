# Auth email per-org config + admin password reset

Issue: [#40](https://github.com/Vibra-Labs/Atrium/issues/40)

## Background

A user reported that password reset emails never arrive on Atrium Cloud. They configured email in System Settings, tried "Forgot password" both for an invited customer and for themselves, and received nothing. They also asked whether selfhosters have any way to reset a customer's password without relying on email at all.

Investigation traced the issue to `apps/api/src/auth/auth.service.ts`. All four Better Auth email callbacks (`sendResetPassword`, `sendVerificationEmail`, `sendInvitationEmail`, `sendMagicLink`) call `mail.send(...)` without passing an `organizationId`. `MailService.send` only consults the per-org System Settings email config when `organizationId` is provided (`apps/api/src/mail/mail.service.ts:58`); without it, the call falls through to the env-var Resend client and silently no-ops if that isn't configured. The result: any auth email completely bypasses per-org SMTP/Resend, even when the user has set it up via the UI.

Separately, when reset email delivery does fail (spam filters, deliverability issues, no email provider), there is no admin path to recover access. The only workaround is editing `account.password` directly in Postgres.

## Goals

- Auth emails (reset password, verify email, invitation, magic link) honor the recipient organization's System Settings email config.
- Owners and admins can generate a password reset link for a member from the Clients page, with the link displayed in the UI for out-of-band sharing and an email also sent when a provider is configured.

## Non-goals

- Admin "set new password directly" UX. Reset link only — the customer still chooses their own password.
- Branded reset/invitation emails per org. Templates remain generic.
- Multi-org email-style preferences. A user belonging to multiple orgs gets one org's config used for their auth emails.

## Part 1 — Auth email per-org config

### Change

Each callback in `auth.service.ts` resolves the `organizationId` for the recipient and passes it to `mail.send`.

| Callback | `organizationId` source |
|---|---|
| `sendResetPassword({ user })` | Look up `Member` rows for `user.id`, take the most recently created. If none, omit `organizationId`. |
| `sendVerificationEmail({ user })` | Same as above. |
| `sendInvitationEmail({ organization })` | `organization.id` directly. |
| `sendMagicLink({ email })` | Look up `User` by email, then `Member` as above. If no user/member, omit `organizationId`. |

A small helper on `AuthService` resolves the primary org for a user id or email, returning `string | undefined`. Both reset and verify use the user-id form; magic link uses the email form.

### Multi-org tradeoff

Some users (e.g. an agency owner who is also a client of another agency on the same Atrium instance) belong to multiple orgs. Picking the most recent `Member` row is a heuristic — it usually means "the org that most recently invited them," which is the most likely intent for verify and invitation emails. For reset password, the user could request from either context; the most recent membership is still a reasonable default and matches the more active relationship. Acceptable. If this becomes a problem, we can later surface "which org are you resetting against" via the forgot-password form.

### Tests

Extend `mail.service.spec.ts` is already covered. New unit tests on `auth.service` mock `mail.send` and verify each of the four callbacks passes the expected `organizationId`. Add an e2e test that configures a mock SMTP for an org, triggers `forget-password`, and asserts the request hits the org's SMTP rather than the env-var Resend (or, if mocking SMTP is too heavy, asserts via spy that `mail.send` was called with the right `organizationId`).

## Part 2 — Admin reset link

### API

`POST /clients/:memberId/reset-password` — owner + admin. Returns `{ url: string, email: string }`.

Service flow:
1. Resolve the target `Member` row, scoped to caller's org. 404 if not found.
2. Validate caller permissions:
   - Caller cannot be the target. (Use `forgot-password` for self.)
   - If target role is `owner`, caller role must be `owner`.
3. Enter an `AsyncLocalStorage` context with a slot for the captured URL.
4. Call `auth.api.forgetPassword({ body: { email: target.user.email, redirectTo: '${WEB_URL}/reset-password' } })`. Better Auth generates the token and invokes our `sendResetPassword` callback.
5. Inside `sendResetPassword`, when the ALS context is active, write the URL into the slot. Email send still happens via `mail.send` (now with org config from Part 1).
6. Read URL from ALS context, return `{ url, email: target.user.email }`.

### Why ALS

Better Auth's public API only surfaces the reset URL inside the `sendResetPassword` callback. Alternatives:
- A module-level `Map<email, url>` is race-prone if two admins reset the same email simultaneously.
- Replicating Better Auth's verification-token format ourselves means duplicating internal schema (token shape, expiry, table layout) and risks drift on Better Auth upgrades.

`AsyncLocalStorage` is the standard Node pattern for request-scoped data and is unaffected by concurrent requests.

### Permissions

Mirrors existing `clients.service.ts` patterns:
- `@Roles("owner", "admin")` on the controller.
- Service-level checks for self-reset and owner-target rules.

### UI

`apps/web/src/app/(dashboard)/dashboard/clients/page.tsx`:

- Each row gets a "Reset password" action (kebab menu or new icon button alongside existing actions).
- Click opens a confirmation modal: "Generate a password reset link for {email}? An email will also be sent if email is configured."
- On confirm, POST to the new endpoint. Replace modal content with:
  - "Reset link generated for {email}."
  - Readonly input containing the URL.
  - Copy button.
  - Note: "This link expires in 1 hour. Refreshing this page will not retrieve it."
- Closing the modal discards the link from UI state.

### E2E test

`e2e/tests/clients-admin-reset.e2e.ts`:
1. Owner logs in, invites a member, member accepts, members logs out.
2. Owner clicks "Reset password" on the member row.
3. Modal appears with a URL.
4. New page navigates to that URL → `/reset-password?token=...` page renders.
5. Member submits a new password → can log in with it.

## Acceptance criteria

- [ ] All four auth callbacks pass `organizationId` to `mail.send` (or omit it deliberately when no org context exists).
- [ ] Forgot-password flow uses the recipient org's SMTP/Resend when configured in System Settings.
- [ ] `POST /clients/:memberId/reset-password` returns `{ url, email }` and triggers email send through the same org-aware path.
- [ ] Permission rules enforced: not self, owners-only-reset-owners.
- [ ] Clients page UI exposes the action and shows the link in a copy-friendly modal.
- [ ] E2E test covers admin-triggered reset end to end.
- [ ] Unit tests cover the four callback `organizationId` lookups and the new permission rules.

## Out of scope

- Custom token expiry for admin-issued links (uses Better Auth default, currently 1 hour).
- Audit log for admin reset actions. Worth adding later if/when Atrium grows a generic audit-log surface; not justified to bolt one in for this single action.
- Bulk reset.
