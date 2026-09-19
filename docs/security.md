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

## API keys

API keys (`atr_…`) are generated from 32 random bytes and stored only as SHA-256 hashes.
A key is bound to one user and one organization and resolves only while that user is an
owner or admin there. Keys are ignored when a session cookie is present, cannot create
or revoke other keys, and are revocable from Settings → API & MCP. Resolved keys are
cached for 30 seconds, in a map the cookie-session path never reads, so a stored key
hash cannot be replayed as a session token. The MCP endpoint is rate limited to 300
requests per minute per key, returning `429` with `Retry-After: 60`. Failed key lookups
(invalid or revoked) are limited to 30 per minute per client IP in `SessionMiddleware`,
before the database is touched; once an IP is limited, MCP answers `429` and the REST API
answers `401`. Per-IP limits assume the reverse proxy overwrites `X-Forwarded-For` with
the real client address: `trust proxy` is on, so a passed-through client value would let
an attacker vary the bucket.

## MCP OAuth

Atrium acts as an OAuth 2.1 authorization server for MCP clients (Better Auth `mcp`
plugin): PKCE with S256 is required (the `plain` method is refused), redirect URIs are
exact-match, access tokens last 1 hour and refresh tokens 30 days. Dynamic client
registration is open, as the MCP spec expects; it refuses redirect URIs that are
unparseable, contain a comma, or use the `javascript:`, `data:`, `vbscript:`, `blob:`,
`file:`, or `about:` schemes (checked again at authorize time), is rate limited to 10
per hour per IP, and unused registrations are pruned after 7 days.

An authorization code cannot be exchanged before the user has pressed Allow. In this
Better Auth version the consent code *is* the authorization code, and the token endpoint
checks only that the code exists and has not expired, so Atrium checks the code's own
`requireConsent` flag first and answers `400 invalid_grant` until consent has actually
been given.

OAuth access tokens are honoured **only** on `POST /api/mcp` (with or without a trailing
slash -- both reach the same route), and only when they arrive as a bearer token: a
browser session cookie does not authenticate that endpoint, so a logged-in user cannot be
made to drive it from another site. The `Bearer` scheme is matched case-insensitively,
per RFC 7235. Tokens cannot call the REST API, and API keys cannot create or remove MCP
grants -- both require a dashboard session. Each grant is bound to one workspace, chosen
on the consent screen, and resolves only while the user is an owner or admin there.

The workspace choice takes effect only once consent succeeds. Pressing Allow first parks
the choice against the consent code (`mcp_pending_grant`); the grant itself is written by
a server-side hook after the plugin's consent endpoint has returned successfully, in the
same transaction that clears the parked row. Abandoning the consent page -- or a consent
that fails -- therefore leaves any existing connection exactly as it was. When a
completed consent does move a client to a different workspace, that client's older tokens
are deleted in that transaction, so a session authorized for the previous workspace is
signed out rather than silently moved. Parked choices whose consent code has expired are
deleted nightly.

The endpoint refuses JSON-RPC batches (`400`, error `-32600`). The current MCP spec has
no batching, and the per-key rate limit counts HTTP requests, so one request carrying an
array of calls would have spent a single token and run all of them.

The plugin stores access **and refresh** tokens unhashed. A database leak therefore
exposes refresh tokens that stay redeemable for 30 days, and MCP clients are public
clients that refresh with `client_id` alone -- no secret is involved. The
single-endpoint rule, not the access token's one-hour lifetime, is what bounds the
impact. The plugin's own `GET /api/auth/mcp/get-session` endpoint, which returns the
whole token row (refresh token included) for any presented access token, is blocked and
answers 404. Token rows whose refresh window has closed are deleted nightly.

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
under Settings → API & MCP → Connected apps.
