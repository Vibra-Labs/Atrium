import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { hashOAuthToken, mcpOAuthEnabled, mcpOAuthUnavailableReason, mcpResourceUrl } from "./mcp-oauth";

function config(values: Record<string, string>): { get: (key: string) => string | undefined } {
  return { get: (key: string) => values[key] };
}

describe("mcpOAuthEnabled", () => {
  it("is on for an https public URL", () => {
    expect(mcpOAuthEnabled(config({ API_URL: "https://portal.example.com" }))).toBe(true);
  });

  it("is on for plain-HTTP localhost, for development", () => {
    expect(mcpOAuthEnabled(config({}))).toBe(true);
    expect(mcpOAuthEnabled(config({ API_URL: "http://127.0.0.1:3001" }))).toBe(true);
  });

  it("is off on a plain-HTTP install reached over the network", () => {
    const values = config({ API_URL: "http://192.168.1.20:3001" });
    expect(mcpOAuthEnabled(values)).toBe(false);
    expect(mcpOAuthUnavailableReason(values)).toContain("https://");
  });

  it("is off when the operator turns it off", () => {
    expect(mcpOAuthEnabled(config({ API_URL: "https://portal.example.com", MCP_OAUTH_ENABLED: "false" }))).toBe(false);
  });
});

describe("mcpResourceUrl", () => {
  it("is the MCP endpoint on the public API URL", () => {
    expect(mcpResourceUrl(config({ API_URL: "https://portal.example.com/" }))).toBe("https://portal.example.com/api/mcp");
  });
});

describe("hashOAuthToken", () => {
  it("is SHA-256, base64url, so a stored token never matches the token itself", () => {
    const expected: string = createHash("sha256").update("tok").digest("base64url");
    expect(hashOAuthToken("tok")).toBe(expected);
    expect(hashOAuthToken("tok")).not.toBe("tok");
  });
});
