import { createHash } from "node:crypto";
import { publicApiUrl } from "./public-api-url";

type ConfigLike = { get: (key: string) => string | undefined };

/** The MCP endpoint's URL, which every OAuth access token is issued for. */
export function mcpResourceUrl(config: ConfigLike): string {
  return `${publicApiUrl(config)}/api/mcp`;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127(\.\d{1,3}){3}$/.test(hostname);
}

/**
 * Why MCP sign-in (OAuth) is off, or null when it is on.
 *
 * Better Auth's MCP plugin refuses a non-HTTPS resource URL (localhost aside)
 * and rewrites a plain-HTTP issuer to https, so on a plain-HTTP install the
 * flow cannot work. API keys still do.
 */
export function mcpOAuthUnavailableReason(config: ConfigLike): string | null {
  if (config.get("MCP_OAUTH_ENABLED") === "false") return "MCP_OAUTH_ENABLED is false";
  let url: URL;
  try {
    url = new URL(publicApiUrl(config));
  } catch {
    return "the public API URL is not a valid URL";
  }
  if (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname))) return null;
  return "it needs an https:// public URL (API_URL or WEB_URL)";
}

export function mcpOAuthEnabled(config: ConfigLike): boolean {
  return mcpOAuthUnavailableReason(config) === null;
}

/**
 * How OAuth codes and tokens are stored: SHA-256, base64url. Better Auth is
 * configured with this (storeTokens) so the MCP endpoint can look an access
 * token up the same way.
 */
export function hashOAuthToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
