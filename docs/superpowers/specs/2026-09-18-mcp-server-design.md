# MCP Server Design

**Date:** 2026-09-18
**Status:** Approved

## Goal

Let agency owners and admins connect AI assistants and agents to their Atrium
instance so the assistant can view and manage projects, clients, tasks,
updates, and internal notes on their behalf.

There are two ways in, sharing one endpoint and one tool set:

- **API key** (bearer token): for headless agents, scripts, the Anthropic
  Messages API MCP connector, OpenAI Responses API, n8n, local-model front
  ends, and any install on plain HTTP or a LAN. Self-hosters can point a local
  model at their own instance; nothing leaves their network.
- **Login** (OAuth 2.1): the user adds only the MCP URL, the client opens
  Atrium's login page, the user approves, and the client receives a token.
  Required by claude.ai and ChatGPT connectors, and the nicer path for Claude
  Code, Cursor, and Claude Desktop. Needs a public HTTPS URL.

Out of scope for this release:

- A published stdio package. `mcp-remote` bridges stdio-only clients meanwhile.
- Keys for portal clients (role `member`).
- Read-only scopes, for keys or OAuth grants.
- Client invitations via MCP. They go through Better Auth's organization
  plugin, which expects a browser session, and need their own design.
- Invoices, time entries, files, documents, labels, comments, branding, and
  settings tools. These follow once the core surface is proven.

## Architecture

Everything lives inside the existing NestJS API. No new service, container,
or port.

```
Client ── Authorization: Bearer atr_… (API key)
       or Authorization: Bearer <oauth access token> ──▶ POST /api/mcp
                                             │
                        SessionMiddleware (bearer branch)
                                             │  req.user / req.organization / req.member
                                             ▼
                        McpService: McpServer + NodeStreamableHTTPServerTransport
                                             │  buildServer(actor) closes over { user, organization, member }
                                             ▼
                        Tool adapters ──▶ existing services (ProjectsService, TasksService, …)
```

Packages: `@modelcontextprotocol/server` and `@modelcontextprotocol/node`
(v2.0.0, MCP spec 2026-07-28). `zod/v4` for tool input schemas. OAuth uses the
`mcp` plugin already shipped in the installed Better Auth (1.4.18).

Build order: API keys and the endpoint first (sections 1–2), then login
(section 3). Each is shippable on its own; the endpoint and tools do not
change between them.

## 1. API keys and auth

### Data model

```prisma
model ApiKey {
  id             String    @id @default(cuid())
  name           String
  keyHash        String    @unique
  keyPrefix      String
  userId         String
  organizationId String
  lastUsedAt     DateTime?
  revokedAt      DateTime?
  createdAt      DateTime  @default(now())

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@map("api_key")
}
```

### Key format

`atr_` followed by 32 random bytes encoded base64url (43 chars). The full key
is returned exactly once at creation. Only the SHA-256 hex hash is stored.
`keyPrefix` is the first 12 characters (`atr_` plus 8) for display.

### ApiKeysService (`apps/api/src/api-keys/`)

| Method | Behavior |
| --- | --- |
| `create(name, userId, organizationId)` | Generates key, stores hash, returns `{ id, name, keyPrefix, key, createdAt }`. |
| `list(organizationId)` | Returns non-revoked keys for the org, without hashes. Includes creator name. |
| `revoke(id, organizationId)` | Sets `revokedAt`. Throws `NotFoundException` if the key is not in that org. |
| `resolve(token)` | Hashes the token, looks up an unrevoked key, loads the user and the member row for that org. Returns `null` if the key is missing, revoked, the user is gone, or the member role is not `owner` or `admin`. Otherwise returns `{ user, organization, member }` in the same shapes the session path produces and bumps `lastUsedAt` (fire-and-forget, throttled to once per minute). |

`resolve` is the single place that enforces "acts as that user": a demoted or
removed user's keys stop working immediately.

### SessionMiddleware bearer branch

In `apps/api/src/auth/session.middleware.ts`:

1. If there is no session cookie and the `Authorization` header matches
   `Bearer atr_…`, call `ApiKeysService.resolve`.
2. On success, set `req.user`, `req.organization`, `req.member`, and a
   synthetic `req.session` with `activeOrganizationId` so downstream code that
   reads it keeps working. Cache under the token with the existing 30 second
   TTL.
3. On failure, set nothing. `AuthGuard` produces the usual 401.
4. If both a cookie and a bearer key are present, the cookie wins and the key
   is ignored. Keeps the CSRF model intact for browser sessions.

Consequences:

- Every existing controller guard works unchanged, so keys can also call the
  REST API directly. This is documented but not the headline feature.
- `CsrfGuard` already skips requests with no session cookie, so key-based
  writes pass without a CSRF token.
- `PreviewModeGuard` is unaffected; keys never send `x-preview-as`.

### REST endpoints (`ApiKeysController`)

All `@UseGuards(AuthGuard, RolesGuard)` and `@Roles("owner", "admin")`.

| Route | Purpose |
| --- | --- |
| `GET /api/api-keys` | List keys for the active org. |
| `POST /api/api-keys` | Body `{ name }` (1–64 chars). Returns the full key once. |
| `DELETE /api/api-keys/:id` | Revoke. |

Creating keys with an API key is refused (`ForbiddenException`) so a leaked
key cannot mint more keys. The middleware sets `req.apiKeyId` on key-authenticated
requests and the controller refuses when it is present.

## 2. MCP endpoint

### Mounting

`McpModule` (`apps/api/src/mcp/`) provides `McpController` and `McpService`.
The controller is a normal Nest controller so that `SessionMiddleware` (a Nest
middleware, registered at init) runs before it:

```
POST   /api/mcp   → McpService.handle(req, res)
GET    /api/mcp   → 405 Method Not Allowed
DELETE /api/mcp   → 405 Method Not Allowed
```

The class is `@Public()` and `@SkipThrottle()`: it does its own identity check
(to control the 401 headers) and its own per-key rate limit. It takes `@Req()`
and `@Res()` only, never `@Body()`, so the global `ValidationPipe` does not
touch JSON-RPC bodies. `@Public()` also makes `CsrfGuard` skip the route.

The server is stateless: per request, one `McpServer` built for the acting
identity and one `NodeStreamableHTTPServerTransport` with
`sessionIdGenerator: undefined`. GET returning 405 is allowed by the spec for
servers that do not push server-initiated messages.

### Authentication on the endpoint

`McpService.handle` reads `req.user`, `req.organization`, and `req.member`.
If any is missing it responds `401` with `WWW-Authenticate: Bearer` and a
JSON-RPC error body. Cookie sessions also satisfy this, which lets the e2e
suite and curious users hit the endpoint from the browser, but the documented
path is the bearer key.

Because a server is built per request, the identity (`Actor`:
`{ user, organization, member }`) is closed over when tools are registered.
Handlers never read it from transport context.

### Tool adapter pattern

Each tool is a plain object in `apps/api/src/mcp/tools/<resource>.tools.ts`,
so it can be unit tested without the SDK:

```ts
defineTool({
  name: "create_project",
  description: "…",
  inputSchema: z.object({ name: z.string().max(255), … }),
  ownerOnly: false,
  handler: async (input, actor) => deps.projects.create(input, actor.organization.id),
});
```

`McpService.buildServer(actor)` loops over every tool and registers it with
one shared wrapper that:

- rejects `ownerOnly` tools when `actor.member.role !== "owner"`,
- returns `{ content: [{ type: "text", text: JSON.stringify(result) }] }` on
  success,
- on error logs and returns `{ isError: true, content: [text] }`, where the
  text is the `HttpException` message when available (NotFound, Forbidden,
  BadRequest, plan-limit) and "Internal error" otherwise.

Inputs are validated by zod with the same limits as the class-validator DTOs,
then passed to the existing services, so service-level checks apply exactly as
on the REST path.

### Tool list

Descriptions are written for the agent: what the tool does, when to use it,
and what identifiers it needs. All list tools cap at 50 results and accept
`limit` and `offset`.

| Tool | Input | Role | Backed by |
| --- | --- | --- | --- |
| `get_workspace` | none | any | org name, slug, acting user name and email, role, MCP version. Lets the agent orient itself in one call. |
| `list_projects` | `status?`, `search?`, `archived?` (default false), paging | admin | `ProjectsService.findAll` |
| `get_project` | `projectId` | admin | `ProjectsService.findOne` |
| `create_project` | `name`, `description?`, `status?`, `startDate?`, `endDate?`, `clientUserIds?` | admin | `ProjectsService.create` |
| `update_project` | `projectId` plus any of the create fields | admin | `ProjectsService.update` |
| `archive_project` | `projectId`, `archived` (bool) | admin | `ProjectsService.archive` / `unarchive` |
| `list_project_statuses` | none | admin | `ProjectsService.getStatuses` |
| `list_clients` | `search?`, paging | admin | same query the clients controller `GET /clients` runs, extracted into `ClientsService.list` |
| `get_client` | `clientId` | admin | `ClientsService.getProfile` plus their projects |
| `list_tasks` | `projectId`, `status?`, paging | admin | `TasksService.findByProject` |
| `create_task` | `projectId`, `title`, `description?`, `dueDate?` | admin | `TasksService.create` (checkbox tasks only) |
| `update_task` | `taskId`, `title?`, `description?`, `dueDate?`, `status?`, `assigneeId?` | admin | `TasksService.update` |
| `delete_task` | `taskId` | admin | `TasksService.remove` |
| `list_updates` | `projectId`, paging | admin | `UpdatesService.findByProject` |
| `post_update` | `projectId`, `content` (markdown) | admin | `UpdatesService.create` with the acting user as author. No attachment support. |
| `list_notes` | `projectId`, paging | admin | `NotesService.findByProject` |
| `add_note` | `projectId`, `content` | admin | `NotesService.create` |
| `delete_note` | `noteId` | admin | `NotesService.remove` |
| `delete_project` | `projectId` | owner | `ProjectsService.remove` |

"admin" means owner or admin, which every key already is. Only
`delete_project` calls `requireOwner`.

The exact field names in the input schemas mirror the existing DTOs. Where a
DTO field is not in this table, it is omitted from the tool for now.

### Rate limiting

The controller skips the global IP-based `ThrottlerGuard`. The MCP
handler applies its own limit of 300 requests per minute per API key using an
in-memory sliding window, returning 429 with `Retry-After`. Generous enough
for an agent loop, tight enough to notice a runaway.

## 3. Login (OAuth)

### Provider

Add Better Auth's `mcp` plugin in `auth.service.ts`:

```ts
mcp({
  loginPage: `${webUrl}/login`,
  resource: `${apiUrl}/api/mcp`,
  oidcConfig: {
    consentPage: `${webUrl}/oauth/consent`,
    allowDynamicClientRegistration: true,
    requirePKCE: true,
    scopes: ["openid", "profile", "email", "offline_access"],
    accessTokenExpiresIn: 3600,
    refreshTokenExpiresIn: 60 * 60 * 24 * 30,
  },
})
```

It serves, under `/api/auth`: `mcp/authorize`, `mcp/token`, `mcp/register`
(dynamic client registration, which claude.ai and ChatGPT rely on),
`oauth2/consent`, and the two discovery documents. It adds three tables to the
Prisma schema, mapped snake_case like the other Better Auth models:
`oauthApplication`, `oauthAccessToken`, `oauthConsent`.

### Discovery routes

MCP clients look for metadata at the origin root, not under `/api/auth`.
A `WellKnownController` (paths excluded from the `api` global prefix in
`main.ts`) serves four GET routes that return the plugin's
documents (via `auth.api.getMcpOAuthConfig` and
`auth.api.getMCPProtectedResource`):

```
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/api/mcp
/.well-known/oauth-authorization-server
/.well-known/oauth-authorization-server/api/auth
```

`docker/Caddyfile` gains `handle /.well-known/oauth-* { reverse_proxy 127.0.0.1:3001 }`
ahead of the catch-all, since today only `/api/*` reaches the API. The
Firebase Hosting rewrite list gets the same entry.

The 401 from `/api/mcp` changes from a bare `WWW-Authenticate: Bearer` to
`Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`,
which is what triggers the login flow in OAuth-capable clients. API key
clients ignore it.

### Login and consent pages

- **Login:** the plugin redirects unauthenticated users to `/login` with the
  original OAuth query string and sets a signed `oidc_login_prompt` cookie.
  After sign-in its after-hook resumes the authorize flow. The login page
  must follow the redirect URL that the sign-in response returns instead of
  always pushing to `/dashboard`. This applies to password and magic-link
  sign-in. It is the one change to the existing login flow and is the first
  thing the plan verifies with a spike.
- **Consent:** new page `apps/web/src/app/(auth)/oauth/consent/page.tsx`. It
  shows the requesting client's name, the statement "This app will be able to
  view and manage projects, clients, tasks, updates, and notes in
  **<workspace>** as you", a workspace picker when the user is owner or admin
  of more than one organization, and Allow / Deny buttons. Users who are not
  owner or admin of any organization see an explanation and only a Deny
  button.

### Binding a grant to an organization

OAuth tokens carry a user and a client, not an organization, and there is no
session row to hold `activeOrganizationId`. A small table records the choice
made on the consent screen:

```prisma
model McpGrant {
  id             String   @id @default(cuid())
  userId         String
  clientId       String
  organizationId String
  createdAt      DateTime @default(now())

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, clientId])
  @@map("mcp_grant")
}
```

On Allow, the consent page first calls `POST /api/mcp-grants`
(`{ clientId, organizationId }`, cookie session, owner or admin of that org
required), then posts to the plugin's `oauth2/consent`. Better Auth remembers
consent per user and client, and the grant row is keyed the same way, so a
returning client keeps its workspace without re-prompting. To switch
workspaces the user disconnects the app (below) and connects again.

### Resolving OAuth tokens

The `SessionMiddleware` bearer branch from section 1 handles both token
kinds:

1. Token starts with `atr_`: `ApiKeysService.resolve`.
2. Otherwise: `McpAuthService.resolve(token)`, which calls
   `auth.api.getMcpSession`, rejects the row if `accessTokenExpiresAt` is in
   the past (the plugin's lookup does not check expiry), loads the `McpGrant`
   for that user and client, and then applies the same rule as API keys: the
   user must still be owner or admin of the bound organization. Returns the
   same `{ user, organization, member }` shape, or `null`.

OAuth tokens are accepted **only** on `/api/mcp`. The middleware ignores them
on every other path, so a token issued to a third-party app cannot call the
REST API or mint API keys. API keys keep working on both.

### Connected apps

The settings page (section 4) lists the user's OAuth grants: client name,
workspace, connected date. **Disconnect** deletes the `McpGrant`, the
`oauthConsent` row, and all `oauthAccessToken` rows for that user and client
via `DELETE /api/mcp-grants/:id`. Owners also see, and can disconnect, grants
made by other admins in their workspace.

### Security notes

- Dynamic client registration is open by design (the spec requires it for
  claude.ai and ChatGPT). Registration is rate limited to 10 per hour per IP,
  and unused applications with no tokens are pruned after 7 days by the
  existing scheduler.
- PKCE is required. Redirect URIs are exact-match, enforced by the plugin.
- The plugin stores access and refresh tokens unhashed. They are short-lived
  (1 hour access, 30 day refresh) and scoped to `/api/mcp` only. Recorded in
  `docs/security.md`.
- A new env flag `MCP_OAUTH_ENABLED` (default `true`) lets an operator turn
  login off. When off, the plugin is not registered, the discovery routes
  return 404, and the 401 header falls back to a bare `Bearer`. API keys are
  unaffected.

## 4. Settings UI

New route `apps/web/src/app/(dashboard)/dashboard/settings/api-keys/`
following the existing settings section pattern (server component page plus a
client section component). Sidebar entry "API & MCP" under settings, visible
to owners and admins.

Contents, top to bottom:

1. **Keys table**: name, prefix (`atr_ab12cd34…`), created by, created date,
   last used (relative), revoke button with confirmation dialog.
2. **Create key** button opens a dialog with a single name field. On success
   the dialog switches to a "copy this now" state showing the full key with
   the existing copy helper (which already falls back to `execCommand` on
   plain HTTP). Closing the dialog clears the key from memory.
3. **Connect an AI assistant** card showing the instance MCP URL
   (`${apiBaseUrl}/api/mcp`) and three copy-ready snippets in tabs:
   - Claude Code: `claude mcp add --transport http atrium <url> --header "Authorization: Bearer <key>"`
   - Cursor / generic JSON config with `url` and `headers`.
   - Anthropic Messages API `mcp_servers` entry with `authorization_token`.

4. **Connected apps** table (section 3): client name, workspace, connected
   date, Disconnect. Hidden when `MCP_OAUTH_ENABLED=false`.

The connect card leads with the login path when OAuth is enabled ("paste this
URL into Claude, ChatGPT, or Cursor and sign in") and shows the API key
snippets underneath for agents and scripts.

API client functions live in `apps/web/src/lib/api.ts` next to the existing
ones: `listApiKeys`, `createApiKey`, `revokeApiKey`, `listMcpGrants`,
`createMcpGrant`, `deleteMcpGrant`.

## 5. Error handling summary

| Situation | Behavior |
| --- | --- |
| Missing or bad bearer token at `/api/mcp` | 401, `WWW-Authenticate: Bearer resource_metadata="…"`, JSON-RPC error. |
| Expired OAuth access token | 401 as above; the client refreshes through `mcp/token`. |
| OAuth token with no `McpGrant`, or grant's org no longer admin-accessible | 401 as above. |
| OAuth token used on a REST route | Ignored, so the usual 401 from `AuthGuard`. |
| Revoked key, demoted or deleted user | `resolve` returns null, so 401 as above. Cache entry expires within 30 s. |
| Service throws HttpException inside a tool | `isError` result with the exception message. |
| Service throws unknown error | logged with pino, `isError` "Internal error". |
| Tool input fails zod | SDK returns JSON-RPC invalid params automatically. |
| Plan limit exceeded (hosted mode) | `PlanGuard` does not run on tools. The limit check moves from `PlanGuard` into `BillingService.assertPlanLimit(orgId, resource)`, which both the guard and `create_project` call and returns the same message as an `isError` result. |
| Over rate limit | 429 with `Retry-After: 60`. |

## 6. Testing

Unit (`apps/api/src/**/*.spec.ts`, no I/O):

- `ApiKeysService`: key format, hash stored not key, `resolve` null on
  revoked / missing / member role, non-null for owner and admin.
- `SessionMiddleware`: bearer branch populates request, cookie wins over
  bearer, malformed header ignored.
- `ApiKeysController`: refuses create when authenticated by key.
- Tool adapters: each tool with mocked services, covering happy path,
  NotFound mapped to `isError`, `delete_project` refused for admin.
- Rate limiter: 301st request in a minute is rejected.
- `McpAuthService.resolve`: null on unknown token, expired token, missing
  grant, demoted user; non-null for a valid grant.
- `SessionMiddleware`: OAuth token populates the request on `/api/mcp` and is
  ignored on `/api/projects`.
- Grants controller: refuses an org where the caller is not owner or admin.

Integration (`apps/api/test/integration/mcp.integration.spec.ts`):

- Mint a key against the test database, call `/api/mcp` with `initialize`,
  `tools/list`, then `create_project` and `list_projects`; assert the project
  exists in Postgres. Revoke the key; assert 401.

- OAuth round trip (`mcp-oauth.integration.spec.ts`): register a client via
  `mcp/register`, drive authorize with a signed-in session and PKCE, post the
  grant and consent, exchange the code at `mcp/token`, call `tools/list` with
  the access token, refresh it, then disconnect and assert 401. Also asserts
  all four discovery URLs return valid metadata.

E2E (`e2e/tests/api-keys.e2e.ts`, `e2e/tests/mcp-oauth.e2e.ts`):

- Settings page: create a key, the full key is shown once, the table lists
  the prefix, revoke removes it. Then the raw key makes a `tools/list` request
  through Playwright's request context and gets 200 before revoke and 401
  after.

- OAuth in the browser: starting from an authorize URL while signed out, the
  user lands on `/login`, signs in, sees the consent page with the client
  name and workspace, clicks Allow, and is redirected to the client's
  redirect URI with a `code`. The app then appears under Connected apps and
  Disconnect removes it. A second test covers Deny.

## 7. Documentation

- `docs/mcp.md`: what it is, creating a key, connecting each client, the tool
  list, security notes (treat keys as passwords, keys act as you, revoke on
  leak).
- `README.md` feature list gains an "MCP server for AI assistants" line.
- `docs/roadmap.md`: add and tick "MCP server".
- `docs/mcp.md` also covers connecting by login (claude.ai, ChatGPT, Claude
  Code), the public HTTPS requirement, and when to prefer a key.
- `.env.example` and `docs/configuration.md`: `MCP_OAUTH_ENABLED`.
- `docs/security.md`: token storage and the `/api/mcp`-only rule.

## Files touched

```
packages/database/prisma/schema.prisma            ApiKey, McpGrant, oauthApplication, oauthAccessToken, oauthConsent
apps/api/src/api-keys/                            module, service, controller, dto, specs
apps/api/src/auth/session.middleware.ts           bearer branch (keys everywhere, OAuth tokens on /api/mcp only)
apps/api/src/auth/auth.service.ts                 mcp plugin
apps/api/src/mcp/mcp-auth.service.ts              OAuth token → actor
apps/api/src/mcp/mcp-grants.controller.ts         create / list / disconnect grants
apps/web/src/app/(auth)/oauth/consent/            consent page
apps/web/src/app/(auth)/login/                    follow post-login redirect
docker/Caddyfile, firebase.json                   route /.well-known/oauth-* to the API
apps/api/src/mcp/                                 module, service, tools/*.tools.ts, helpers, rate limiter, specs
apps/api/src/clients/clients.service.ts           extract list query from controller
apps/api/src/main.ts                              exclude /.well-known/* from the api prefix
apps/api/src/app.module.ts                        import new modules
apps/api/package.json                             @modelcontextprotocol/server, @modelcontextprotocol/node, zod
apps/api/test/integration/mcp.integration.spec.ts
apps/web/src/app/(dashboard)/dashboard/settings/api-keys/
apps/web/src/lib/api.ts                           key API calls
apps/web/src/components/… (settings nav)          sidebar entry
e2e/tests/api-keys.e2e.ts, e2e/tests/mcp-oauth.e2e.ts
docs/mcp.md, README.md, docs/roadmap.md
```
