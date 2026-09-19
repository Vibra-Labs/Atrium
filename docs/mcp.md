# MCP Server (AI assistants)

Atrium includes a [Model Context Protocol](https://modelcontextprotocol.io) server so AI
assistants and agents can view and manage your workspace. It works with any MCP client
and any model provider: Claude, OpenAI, local models behind Open WebUI or LibreChat,
n8n, or your own agent.

- **Endpoint:** `https://<your-atrium-host>/api/mcp` (Streamable HTTP, stateless)
- **Auth:** sign in with your Atrium account (OAuth), or send an API key as `Authorization: Bearer atr_…`

## Option A: Connect by signing in

Best for claude.ai, ChatGPT, Claude Desktop, Claude Code, and Cursor. Requires your
Atrium instance to be reachable at a public **HTTPS** address.

1. In your AI client, add a custom MCP connector (or server) and paste your MCP URL:
   `https://portal.example.com/api/mcp`. Leave any client ID / secret fields empty.
2. The client opens Atrium. Sign in if asked.
3. Review the request, pick the workspace if you have more than one, and click **Allow**.

Claude Code: `claude mcp add --transport http atrium https://portal.example.com/api/mcp`,
then run `/mcp` and choose **Authenticate**.

The assistant acts as you in the workspace you picked. Only owners and admins can
connect. See and disconnect assistants under **Settings → API & MCP → Connected apps**;
disconnecting takes effect within 30 seconds. Consent is shown every time you connect, so
to move an assistant to a different workspace, just reconnect it and pick another
workspace on the consent screen -- there's no need to disconnect first.

**When to use an API key instead:** headless agents and scripts, the Anthropic or OpenAI
APIs, n8n, local-model front ends, and any instance on plain HTTP or a private network.

To turn sign-in connections off entirely, set `MCP_OAUTH_ENABLED="false"`.

If you run a split deployment (API and web on different hosts) behind your own reverse
proxy, route `/.well-known/oauth-*` to the API -- the discovery documents are served at
the origin root, not under `/api`. The bundled `docker/Caddyfile` already does this for
the unified image.

## Option B: Use an API key

### 1. Create an API key

Go to **Settings → API & MCP**, name the key, and click **Create key**. Copy it
immediately; Atrium stores only a hash and cannot show it again.

A key acts as **you** in **that workspace**, with your role. Only owners and admins can
create keys. If you are later demoted or removed, your keys stop working within 30
seconds (the resolve cache TTL). Revoke a key from the same page; revocation takes
effect within the same 30-second window.

### 2. Connect a client

**Claude Code**

```bash
claude mcp add --transport http atrium https://portal.example.com/api/mcp \
  --header "Authorization: Bearer atr_your_key"
```

**Cursor, Claude Desktop, and other JSON-configured clients**

```json
{
  "mcpServers": {
    "atrium": {
      "url": "https://portal.example.com/api/mcp",
      "headers": { "Authorization": "Bearer atr_your_key" }
    }
  }
}
```

Clients that only support stdio servers can bridge with
`npx mcp-remote https://portal.example.com/api/mcp --header "Authorization: Bearer atr_your_key"`.

**Anthropic Messages API (MCP connector)**

```json
{
  "mcp_servers": [
    { "type": "url", "url": "https://portal.example.com/api/mcp", "name": "atrium", "authorization_token": "atr_your_key" }
  ],
  "tools": [{ "type": "mcp_toolset", "mcp_server_name": "atrium" }]
}
```

Send the beta header `anthropic-beta: mcp-client-2025-11-20`. The Anthropic API must be
able to reach your instance, so it needs a public URL.

**Local models.** Point your MCP-capable front end (Open WebUI, LibreChat, LM Studio,
and similar) at the same URL with the same header. Nothing leaves your network.

## Tools

| Tool | What it does |
| --- | --- |
| `get_workspace` | The workspace and user this connection acts as |
| `list_projects`, `get_project` | Browse projects |
| `create_project`, `update_project`, `archive_project` | Manage projects |
| `delete_project` | Permanently delete a project (owner only) |
| `list_project_statuses` | The workspace's status options |
| `list_clients`, `get_client` | People in the workspace, their profile and projects |
| `list_tasks`, `create_task`, `update_task`, `delete_task` | Manage tasks |
| `list_updates`, `post_update` | Client-visible progress updates |
| `list_notes`, `add_note`, `delete_note` | Internal notes (never visible to clients) |

19 tools in total. List tools take `page` and `limit` (max 50). `post_update` is
visible to clients and may trigger email notifications.

## Limits and security

- Authenticated requests are limited to 300 per minute per API key, returning `429` with
  `Retry-After: 60`. Invalid and revoked keys are limited to 30 per minute per client IP
  in `SessionMiddleware`, before the key is looked up in the database; once an IP is
  limited, MCP answers `429` and the REST API answers the usual `401`. Per-IP limits
  assume your reverse proxy overwrites `X-Forwarded-For` with the real client address;
  if it appends to or passes through a client-supplied value, the limit can be evaded.
- Treat keys like passwords. Anyone holding a key can do what you can do in that workspace.
- Keys also authenticate the REST API (`/api/*`) with the same permissions. Keys cannot
  create or revoke keys; both require a dashboard session.
- Give each assistant its own key so you can revoke one without disturbing the others.

## Troubleshooting

- A harmless Prisma `P2025` ("record to delete does not exist") in the API logs on a
  successful sign-in token exchange comes from Better Auth's `mcp` plugin, not from
  Atrium -- it can be ignored.
