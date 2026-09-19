/** The MCP JSON-RPC endpoint. */
const MCP_PATH = "/api/mcp";

/**
 * Whether a request URL addresses the MCP endpoint.
 *
 * Express routes both `/api/mcp` and `/api/mcp/` to the same handler, so
 * anything that gates behaviour on that endpoint — OAuth bearer tokens, the
 * CSRF exemption — has to accept the trailing slash too, or a client that
 * appends one authenticates forever without ever getting in.
 *
 * Exactly one optional trailing slash, and nothing else: `/api/mcp/x`,
 * `/api/mcpx`, `/api/mcp-grants` and `/api/mcp//` are different routes, and
 * the comparison is case sensitive because Express paths are.
 */
export function isMcpPath(originalUrl: string): boolean {
  const queryStart: number = originalUrl.indexOf("?");
  const path: string = queryStart === -1 ? originalUrl : originalUrl.slice(0, queryStart);
  return path === MCP_PATH || path === `${MCP_PATH}/`;
}
