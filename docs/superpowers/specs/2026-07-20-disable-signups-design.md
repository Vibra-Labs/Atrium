# Disable Signups — Design

**Issue:** [#54](https://github.com/Vibra-Labs/Atrium/issues/54) — allow a self-hoster to disable/limit signups so only one company exists per host.

## Goal

Give operators a switch to close public self-serve signup. When off, no new organizations can be created via `POST /onboarding/signup`; everything else (login, invited-client onboarding) keeps working.

## Decision

Manual **env var** toggle, not a UI toggle. Signup is a host-global concern, but Atrium's settings/roles model is entirely per-organization with no instance-level admin. An env var is the correct primitive for a host-level policy and ships without a schema change. A Settings UI toggle was considered and deferred — it would require a new instance-level settings store and a global-authorization decision (whose org governs the one shared signup page when multiple orgs exist).

## Behavior

- New env var **`ALLOW_SIGNUPS`**, string flag matching the existing `BILLING_ENABLED` convention.
- **Default `"true"`** — if the var is absent or any value other than `"false"`, signups stay enabled. Preserves current behavior on upgrade.
- Set `ALLOW_SIGNUPS="false"` to close signups.
- **Scope:** blocks only new-org self-serve signup. Login and the `/accept-invite` invitation flow are untouched.

## Changes

| Layer | File | Change |
|---|---|---|
| API enforcement | `apps/api/src/onboarding/onboarding.controller.ts` | At the top of `signup()`, if `ALLOW_SIGNUPS` !== `"true"`, throw `ForbiddenException("Signups are disabled")` before any user/org creation. This is the real gate. |
| Config expose | `apps/api/src/health.controller.ts` | Add `signupEnabled: this.config.get("ALLOW_SIGNUPS", "true") === "true"` to the public `GET /health/config` response. |
| Frontend config | `apps/web/src/lib/app-config.ts` | Add `signupEnabled: boolean` to `AppConfig`; default `true` in the catch fallback. |
| Frontend signup page | `apps/web/src/app/(auth)/signup/page.tsx` | When `config?.signupEnabled === false`, render a centered "Signups are disabled" message with a link to `/login` instead of the plan/account steps. |
| Docs | `.env.example` | Document `ALLOW_SIGNUPS="true"` with a comment near the auth/onboarding section. |

Untouched: login, `/accept-invite`, invitations, billing.

## Error handling

- API returns HTTP 403 with message `"Signups are disabled"` — the frontend already surfaces `data.message` on non-OK responses, so a user who reaches the endpoint directly gets a clear error.
- Frontend fails open to `signupEnabled: true` only if `/health/config` is unreachable (matches existing `billingEnabled` fallback). The API guard is the authoritative enforcement regardless of what the UI shows.

## Testing (e2e, required)

New spec in `e2e/tests/`:

1. With `ALLOW_SIGNUPS="false"`: `POST /api/onboarding/signup` returns 403, and the `/signup` page shows the disabled message (no form).
2. Sanity: login still works with signups disabled.

The flag is read from API env at request time. Confirm how the e2e harness sets API env (`e2e/global-setup.ts` / Playwright `webServer`) — the disabled-state test needs the API started with `ALLOW_SIGNUPS=false`. If the harness starts a single shared API, the test may assert the 403 path via a dedicated run or config; resolve this when writing the test rather than assuming.

## Non-goals

- No Settings UI toggle (deferred; would need instance-level settings + global-auth design).
- No auto single-tenant "block once an org exists" behavior.
- No changes to invitations or login.
