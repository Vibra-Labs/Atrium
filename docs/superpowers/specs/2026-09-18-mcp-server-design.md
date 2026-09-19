# MCP Server Design

**Date:** 2026-09-18
**Status:** Approved

## Goal

Let agency owners and admins connect AI assistants and agents to their Atrium
instance so the assistant can view and manage projects, clients, tasks,
updates, and internal notes on their behalf.

The first release targets any client that can speak MCP over Streamable HTTP
with a bearer token: the Anthropic Messages API MCP connector, Claude Code,
Cursor, Claude Desktop, Open WebUI, LibreChat, n8n, OpenAI Responses API, and
local-model front ends. Self-hosters can point a local model at their own
instance; nothing leaves their network.

Out of scope for this release:

- OAuth (needed only by claude.ai custom connectors and ChatGPT connectors).
  The key-based endpoint built here is the prerequisite for it.
- A published stdio package. `mcp-remote` bridges stdio-only clients meanwhile.
- Keys for portal clients (role `member`).
- Read-only key scopes.
- Client invitations via MCP. They go through Better Auth's organization
  plugin, which expects a browser session, and need their own design.
- Invoices, time entries, files, documents, labels, comments, branding, and
  settings tools. These follow once the core surface is proven.

## Architecture

Everything lives inside the existing NestJS API. No new service, container,
or port.

```
Client ── Authorization: Bearer atr_… ──▶ POST /api/mcp
                                             │
                        SessionMiddleware (bearer branch)
                                             │  req.user / req.organization / req.member
                                             ▼
                        McpService: McpServer + NodeStreamableHTTPServerTransport
                                             │  authInfo.extra = { user, organization, member }
                                             ▼
                        Tool adapters ──▶ existing services (ProjectsService, TasksService, …)
```

Packages: `@modelcontextprotocol/server` and `@modelcontextprotocol/node`
(v2.0.0, MCP spec 2026-07-28). `zod/v4` for tool input schemas.

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
key cannot mint more keys. The controller checks `req.session` came from a
cookie (the synthetic session carries a flag).

## 2. MCP endpoint

### Mounting

`McpModule` (`apps/api/src/mcp/`) exposes `McpService`. In `main.ts`, after
`SessionMiddleware` is in place, the Express instance gets:

```
POST   /api/mcp   → McpService.handle(req, res)
GET    /api/mcp   → 405 Method Not Allowed
DELETE /api/mcp   → 405 Method Not Allowed
```

Registered as a raw Express route so the global `ValidationPipe` and
exception filter do not touch JSON-RPC bodies. `express.json()` already runs
globally; the handler passes `req.body` to the transport.

The server is stateless: one `NodeStreamableHTTPServerTransport` with
`sessionIdGenerator: undefined` per request, and one `McpServer` instance
per request (tools are registered by a factory so per-request construction is
cheap and keeps no shared state). GET returning 405 is allowed by the spec for
servers that do not push server-initiated messages.

### Authentication on the endpoint

`McpService.handle` reads `req.user`, `req.organization`, and `req.member`.
If any is missing it responds `401` with `WWW-Authenticate: Bearer` and a
JSON-RPC error body. Cookie sessions also satisfy this, which lets the e2e
suite and curious users hit the endpoint from the browser, but the documented
path is the bearer key.

The identity is passed to tool handlers through the transport's `authInfo`
pass-through: `req.auth = { token, clientId: apiKeyId, scopes: [], extra: { user, organization, member } }`.
Tool handlers read `ctx.authInfo.extra`.

### Tool adapter pattern

Each tool is a small function in `apps/api/src/mcp/tools/<resource>.tools.ts`
exporting a `register(server, deps)` function. `deps` is the set of injected
services. Pattern:

```ts
server.registerTool("create_project", { description, inputSchema }, async (input, ctx) => {
  const { organization, member } = actor(ctx);
  try {
    const project = await deps.projects.create(input, organization.id);
    return ok(project);
  } catch (err) {
    return fail(err);
  }
});
```

- `actor(ctx)` extracts the identity and throws if absent.
- `ok(value)` returns `{ content: [{ type: "text", text: JSON.stringify(value) }] }`.
- `fail(err)` logs and returns `{ isError: true, content: [{ type: "text", text: message }] }`
  where `message` is the HttpException response message when available, so
  NotFound, Forbidden, validation, and plan-limit errors reach the agent
  verbatim. Unknown errors return "Internal error".
- `requireOwner(member)` throws a `ForbiddenException` for tools that map to
  owner-only REST routes.
- Inputs are validated by zod. Service DTOs are class-validator classes; the
  adapter maps validated zod output into the DTO shape and calls the service
  directly, so the same service-level checks apply as on the REST path.

### Tool list

Descriptions are written for the agent: what the tool does, when to use it,
and what identifiers it needs. All list tools cap at 50 results and accept
`limit` and `offset`.

| Tool | Input | Role | Backed by |
| --- | --- | --- | --- |
| `get_workspace` | none | any | org name, slug, acting user name and email, role, MCP version. Lets the agent orient itself in one call. |
| `list_projects` | `status?`, `search?`, `archived?` (default false), paging | admin | `ProjectsService.findAll` |
| `get_project` | `projectId` | admin | `ProjectsService.findOne` |
| `create_project` | `name`, `description?`, `status?`, `startDate?`, `endDate?`, `clientIds?` | admin | `ProjectsService.create` |
| `update_project` | `projectId` plus any of the create fields | admin | `ProjectsService.update` |
| `archive_project` | `projectId`, `archived` (bool) | admin | `ProjectsService.archive` / `unarchive` |
| `list_project_statuses` | none | admin | `ProjectsService.getStatuses` |
| `list_clients` | `search?`, paging | admin | same query the clients controller `GET /clients` runs, extracted into `ClientsService.list` |
| `get_client` | `clientId` | admin | `ClientsService.getProfile` plus their projects |
| `list_tasks` | `projectId`, `status?`, paging | admin | `TasksService.findByProject` |
| `create_task` | `projectId`, `title`, `description?`, `status?`, `dueDate?`, `assigneeId?` | admin | `TasksService.create` |
| `update_task` | `taskId` plus any create field | admin | `TasksService.update` |
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

The global `ThrottlerGuard` does not run on the raw Express route. The MCP
handler applies its own limit of 300 requests per minute per API key using an
in-memory sliding window, returning 429 with `Retry-After`. Generous enough
for an agent loop, tight enough to notice a runaway.

## 3. Settings UI

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

API client functions live in `apps/web/src/lib/api.ts` next to the existing
ones: `listApiKeys`, `createApiKey`, `revokeApiKey`.

## 4. Error handling summary

| Situation | Behavior |
| --- | --- |
| Missing or bad bearer key at `/api/mcp` | 401, `WWW-Authenticate: Bearer`, JSON-RPC error. |
| Revoked key, demoted or deleted user | `resolve` returns null, so 401 as above. Cache entry expires within 30 s. |
| Service throws HttpException inside a tool | `isError` result with the exception message. |
| Service throws unknown error | logged with pino, `isError` "Internal error". |
| Tool input fails zod | SDK returns JSON-RPC invalid params automatically. |
| Plan limit exceeded (hosted mode) | `PlanGuard` does not run on tools. `create_project` calls `BillingService` the same way `PlanGuard` does (only when `BILLING_ENABLED=true`) and returns the same message as an `isError` result. |
| Over rate limit | 429 with `Retry-After: 60`. |

## 5. Testing

Unit (`apps/api/src/**/*.spec.ts`, no I/O):

- `ApiKeysService`: key format, hash stored not key, `resolve` null on
  revoked / missing / member role, non-null for owner and admin.
- `SessionMiddleware`: bearer branch populates request, cookie wins over
  bearer, malformed header ignored.
- `ApiKeysController`: refuses create when authenticated by key.
- Tool adapters: each tool with mocked services, covering happy path,
  NotFound mapped to `isError`, `delete_project` refused for admin.
- Rate limiter: 301st request in a minute is rejected.

Integration (`apps/api/test/integration/mcp.integration.spec.ts`):

- Mint a key against the test database, call `/api/mcp` with `initialize`,
  `tools/list`, then `create_project` and `list_projects`; assert the project
  exists in Postgres. Revoke the key; assert 401.

E2E (`e2e/tests/api-keys.e2e.ts`):

- Settings page: create a key, the full key is shown once, the table lists
  the prefix, revoke removes it. Then the raw key makes a `tools/list` request
  through Playwright's request context and gets 200 before revoke and 401
  after.

## 6. Documentation

- `docs/mcp.md`: what it is, creating a key, connecting each client, the tool
  list, security notes (treat keys as passwords, keys act as you, revoke on
  leak).
- `README.md` feature list gains an "MCP server for AI assistants" line.
- `docs/roadmap.md`: add and tick "MCP server".
- `.env.example`: no new variables. The MCP URL derives from the existing
  API URL.

## Files touched

```
packages/database/prisma/schema.prisma            ApiKey model
apps/api/src/api-keys/                            module, service, controller, dto, specs
apps/api/src/auth/session.middleware.ts           bearer branch
apps/api/src/mcp/                                 module, service, tools/*.tools.ts, helpers, rate limiter, specs
apps/api/src/clients/clients.service.ts           extract list query from controller
apps/api/src/main.ts                              mount /api/mcp
apps/api/src/app.module.ts                        import new modules
apps/api/package.json                             @modelcontextprotocol/server, @modelcontextprotocol/node, zod
apps/api/test/integration/mcp.integration.spec.ts
apps/web/src/app/(dashboard)/dashboard/settings/api-keys/
apps/web/src/lib/api.ts                           key API calls
apps/web/src/components/… (settings nav)          sidebar entry
e2e/tests/api-keys.e2e.ts
docs/mcp.md, README.md, docs/roadmap.md
```
