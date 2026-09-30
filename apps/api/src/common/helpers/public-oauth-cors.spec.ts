import { describe, expect, it } from "bun:test";
import { isPublicOAuthPath } from "./public-oauth-cors";

describe("isPublicOAuthPath", () => {
  it("matches the dynamic client registration endpoint", () => {
    expect(isPublicOAuthPath("/api/auth/mcp/register")).toBe(true);
    expect(isPublicOAuthPath("/api/auth/mcp/register?x=1")).toBe(true);
  });

  it("matches the token endpoint", () => {
    expect(isPublicOAuthPath("/api/auth/mcp/token")).toBe(true);
    expect(isPublicOAuthPath("/api/auth/mcp/token?x=1")).toBe(true);
  });

  it("matches the OAuth discovery documents", () => {
    expect(isPublicOAuthPath("/.well-known/oauth-authorization-server")).toBe(true);
    expect(isPublicOAuthPath("/.well-known/oauth-authorization-server/api/auth")).toBe(true);
    expect(isPublicOAuthPath("/.well-known/oauth-protected-resource")).toBe(true);
    expect(isPublicOAuthPath("/.well-known/oauth-protected-resource/api/mcp")).toBe(true);
    expect(isPublicOAuthPath("/.well-known/oauth-protected-resource?x=1")).toBe(true);
  });

  it("does not match the rest of the auth proxy", () => {
    expect(isPublicOAuthPath("/api/auth/mcp/authorize")).toBe(false);
    expect(isPublicOAuthPath("/api/auth/sign-in/email")).toBe(false);
    expect(isPublicOAuthPath("/api/auth/mcp/tokenx")).toBe(false);
    expect(isPublicOAuthPath("/api/auth/mcp/registerx")).toBe(false);
  });

  it("does not match the MCP endpoint or other well-known documents", () => {
    expect(isPublicOAuthPath("/api/mcp")).toBe(false);
    expect(isPublicOAuthPath("/.well-known/openid-configuration")).toBe(false);
    expect(isPublicOAuthPath("/.well-known/")).toBe(false);
  });

  it("does not match unrelated paths or an empty path", () => {
    expect(isPublicOAuthPath("/api/projects")).toBe(false);
    expect(isPublicOAuthPath("")).toBe(false);
  });
});
