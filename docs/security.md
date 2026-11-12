# Security

Atrium ships with production-grade security defaults:

- Helmet CSP restricting scripts, styles, images, and connections to `'self'`
- CORS locked to a single origin (`WEB_URL`) with credentials
- Global rate limiting (100 requests/min) via `@nestjs/throttler`
- `ValidationPipe` with `whitelist` and `forbidNonWhitelisted` on all endpoints
- Auth guard + roles guard on all non-public routes
- Global exception filter that hides stack traces from clients
- File upload sanitization with blocked dangerous extensions
- Non-root Docker containers
- Required env var validation at startup

## Two-factor authentication

Any user can turn on an authenticator app (TOTP) in Settings → Security, with 10
single-use recovery codes that must be saved before 2FA turns on. A workspace owner can
require it for owners and admins ("Require two-factor for staff"); clients are never
required to use it.

**Every session records which second factor it passed** (`session.secondFactor`:
`totp`, `backup_code`, `trusted_device`, or none). A session whose user has 2FA but
which never passed it is *pending*: it can read itself, enter a code
(`/api/auth/two-factor/verify-totp` or `/verify-backup-code`), start a new sign-in, or
sign out, and every other request — Better Auth's own routes through the auth proxy
included — gets `403 { code: "SECOND_FACTOR_REQUIRED" }`. So an emailed sign-in link,
a password reset or any other first-factor sign-in never gets around 2FA. A pending
session is signed out after 5 wrong codes. Staff of a workspace that requires 2FA and
have none get `403 { code: "TWO_FACTOR_REQUIRED" }` until they set it up (they may still
list and switch workspaces). Better Auth's organization routes accept any workspace id,
so there the rule applies whichever workspace is active. The rule is applied by `SecondFactorGuard`, a global guard.

"Trust this device for 30 days" is offered only after a password. Turning 2FA on makes
the user's other sessions pending; the session cache is cleared for that user at once
on the instance that handled it (other API instances catch up within 30 seconds).

API keys and MCP OAuth tokens are not sessions and are not gated. New ones can only be
created from a session, which for a user with 2FA must have passed it. Keys and MCP
connections made before 2FA was turned on keep working, so revoke and recreate them
(Settings → Integrations) after turning 2FA on if they may have leaked.

Turning 2FA off and making new recovery codes need a current code (or a recovery code),
checked by the server, plus the password for accounts that have one. Once 2FA is on, the
authenticator secret is never handed out again.

**Recovery.** A password reset never removes 2FA. A user who has lost their
authenticator uses a recovery code. Otherwise an owner can reset anyone's 2FA in the
workspace, and an admin anyone's but an owner's (team page for staff, the contact page
for clients); the actor confirms with their own code if they have 2FA. This is refused
when the person also belongs to another workspace, so one workspace cannot weaken an
account another relies on. A reset removes the authenticator, recovery codes and
trusted devices, signs the person out everywhere, and emails them. The server operator
can do the same with:

```bash
cd apps/api && bun run script:disable-2fa <email> --reason "<note>"
```

which runs the compiled build (`bun run build` first in a checkout; in the Docker image,
run it from `/app/apps/api`). Users are emailed when their password is reset, when 2FA is
turned off, and when a recovery code is used.

### Passkeys

Owners and admins (of any workspace) can add passkeys in Settings → Security, sign in with
one ("Continue with a passkey"), and use one as their second factor. Every passkey
requires user verification (device PIN or biometric), so a passkey sign-in counts as
two factors and satisfies "Require two-factor for staff". Clients cannot register one;
the server refuses it.

Passkeys are tied to the main web address (`WEB_URL`), never the API host or an agency's
custom portal domain, and are switched off unless `WEB_URL` is `https://` (or
`http://localhost`). `FIREBASE_HOSTING=true` also turns them off, since it drops the
challenge cookie.

- A session waiting for its second factor can sign in with a passkey (which replaces and
  deletes that session) but cannot add one.
- Adding a passkey can never sign anyone in (`createSession` is refused).
- Adding or removing a passkey needs no extra proof beyond a verified session; Better
  Auth requires that session to be under a day old to add one. Both send an alert email.
- Staff of a workspace that requires 2FA cannot remove their last factor, whether that is
  the authenticator app or their last passkey.
- Owner/admin resets and `script:disable-2fa --passkeys` remove passkeys too. A user with
  only passkeys has no recovery codes; the app nudges them to add a backup.

## API keys

API keys (`atr_…`) are generated from 32 random bytes and stored only as SHA-256 hashes.
A key is bound to one membership (user + organization) and resolves only while that user
is an owner or admin there. Removing the member deletes its keys and MCP grants (both
cascade from `member`, whichever route removes it, including Better Auth's own
`/organization/leave`), and a re-added user gets a new member row that none of the old
credentials point at. Demotion below admin revokes the keys and deletes the grants in the
same transaction as the role change (or in Better Auth's `afterUpdateMemberRole` hook for
its own endpoint), so a later re-promotion does not revive them. Keys are ignored when a session cookie is present, cannot create
or revoke other keys, and are revocable from Settings → Integrations. Resolved keys are
cached for 30 seconds, in a map the cookie-session path never reads, so a stored key
hash cannot be replayed as a session token. The MCP endpoint is rate limited to 300
requests per minute per key (per user for OAuth tokens), returning `429` with `Retry-After: 60`. Failed key lookups
(invalid or revoked) are limited to 30 per minute per client IP in `SessionMiddleware`,
before the database is touched; once an IP is limited, MCP answers `429` and the REST API
answers `401`. Per-IP limits assume the reverse proxy overwrites `X-Forwarded-For` with
the real client address: `trust proxy` is on, so a passed-through client value would let
an attacker vary the bucket.

## MCP OAuth

Atrium acts as an OAuth 2.1 authorization server for MCP clients (Better Auth's
`@better-auth/mcp` plugin): PKCE with S256 is required (the `plain` method is refused),
redirect URIs are exact-match, access tokens last 1 hour and refresh tokens 30 days.
Dynamic client registration is open, as the MCP spec expects; it refuses redirect URIs
that are unparseable, contain a comma, or use the `javascript:`, `data:`, `vbscript:`,
`blob:`, `file:`, or `about:` schemes (checked again at authorize time), is rate limited
to 10 per hour per IP, and unused registrations are pruned after 7 days.

The consent page is shown on every authorization, even for a client the user approved
before and even when the client sends `prompt=none`, because it is where the user picks
the workspace. The plugin issues an authorization code only after the user presses Allow,
and it signs the request it hands the consent page, so the page (and the API behind it)
reads the client and redirect URI from that signed request, never from bare query
parameters.

MCP sign-in needs an `https://` public URL (or `localhost` for development). On a
plain-HTTP install it is switched off with a warning at startup, and MCP clients connect
with an API key instead.

OAuth access tokens are honoured **only** on `POST /api/mcp` (with or without a trailing
slash -- both reach the same route), and only when they arrive as a bearer token: a
browser session cookie does not authenticate that endpoint, so a logged-in user cannot be
made to drive it from another site. The `Bearer` scheme is matched case-insensitively,
per RFC 7235. Tokens cannot call the REST API, and API keys cannot create or remove MCP
grants -- both require a dashboard session. Each grant is bound to one workspace, chosen
on the consent screen, and resolves only while the user is an owner or admin there.

The workspace choice takes effect only once consent succeeds. The consent screen records
the chosen workspace against the signed request and the signed-in user before it submits
the approval (`mcp_pending_grant`), and that parked choice grants nothing on its own: the grant is
written afterwards by a server-side hook, only once the plugin's consent endpoint has
returned successfully, in the same transaction that clears the parked row. Abandoning the
consent page -- or a consent that fails -- therefore leaves any existing connection
exactly as it was. When a
completed consent does move a client to a different workspace, that client's older tokens
are deleted in that transaction, so a session authorized for the previous workspace is
signed out rather than silently moved. Parked choices whose request has expired are
deleted nightly.

The endpoint refuses JSON-RPC batches (`400`, error `-32600`). The current MCP spec has
no batching, and the per-key rate limit counts HTTP requests, so one request carrying an
array of calls would have spent a single token and run all of them.

Access tokens are opaque and stored as SHA-256 hashes, as are refresh tokens and
authorization codes, so a database leak does not expose usable tokens. Tokens are
ordinary bearer tokens: the token endpoint ignores DPoP proofs, because the MCP endpoint
does not check them. Expired tokens are deleted nightly.

Disconnecting an app deletes its tokens and workspace grant; because of the 30-second
auth cache, a token can keep working for up to 30 seconds after disconnect or expiry.
The recorded consent is kept on purpose -- it grants nothing, but it marks the
registration as one a person approved, so the nightly prune of abandoned registrations
leaves it in place and the client can reconnect by signing in again instead of failing
with `invalid_client`.

Setting `MCP_OAUTH_ENABLED="false"` unmounts the OAuth endpoints *and* stops honouring
access tokens that were already issued, so turning the feature off disconnects existing
clients immediately rather than an hour later.

Better Auth's own rate limiter -- including the 10-per-hour rule on dynamic client
registration -- is active only when `NODE_ENV=production`. The application's other
limits (the global throttler, the per-key MCP limit, the failed-key limiter) apply in
every environment.

Because registration is anonymous, the consent screen shows a client-chosen name --
so it also shows where approving will send you, read from the pending request itself.
Only approve a connection you started yourself. Review and disconnect apps anytime
under Settings → Integrations → Connected apps.
