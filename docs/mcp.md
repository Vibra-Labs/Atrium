# MCP Server (AI assistants)

Atrium includes a [Model Context Protocol](https://modelcontextprotocol.io) server so AI
assistants and agents can view and manage your workspace. It works with any MCP client
and any model provider: Claude, OpenAI, local models behind Open WebUI or LibreChat,
n8n, or your own agent.

- **Endpoint:** `https://<your-atrium-host>/api/mcp` (Streamable HTTP, stateless)
- **Auth:** an API key sent as `Authorization: Bearer atr_…`

## 1. Create an API key

Go to **Settings → API & MCP**, name the key, and click **Create key**. Copy it
immediately; Atrium stores only a hash and cannot show it again.

A key acts as **you** in **that workspace**, with your role. Only owners and admins can
create keys. If you are later demoted or removed, your keys stop working. Revoke a key
from the same page; revocation takes effect within 30 seconds.

## 2. Connect a client

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

- Authenticated requests are limited to 300 per minute per API key. Requests with no
  key, an invalid key, or a revoked key are limited to 30 per minute per IP address.
  Both return `429` with `Retry-After: 60`.
- Treat keys like passwords. Anyone holding a key can do what you can do in that workspace.
- Keys also authenticate the REST API (`/api/*`) with the same permissions. Keys cannot
  create other keys.
- Give each assistant its own key so you can revoke one without disturbing the others.
