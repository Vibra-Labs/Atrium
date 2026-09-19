/**
 * The workspace roles that may act through a bearer token — an API key or an
 * MCP OAuth access token. Portal clients are `member`, and every MCP tool
 * changes state, so only owners and admins resolve to an actor.
 *
 * Shared deliberately: `ApiKeysService` and `McpAuthService` enforce it when
 * they resolve a token, and `McpService` re-checks it as defence in depth.
 * Three separate copies would let the three drift apart.
 */
export const MCP_ACTOR_ROLES: string[] = ["owner", "admin"];
