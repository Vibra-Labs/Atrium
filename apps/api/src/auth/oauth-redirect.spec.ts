import { describe, it, expect } from "bun:test";
import { isAllowedRedirectUri } from "./oauth-redirect";

describe("isAllowedRedirectUri", () => {
  it("allows the URIs real MCP clients register", () => {
    // Hosted clients.
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(
      true,
    );
    // Loopback redirects from CLI clients — http, deliberately allowed.
    expect(isAllowedRedirectUri("http://127.0.0.1:54321/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:8976/oauth/callback")).toBe(
      true,
    );
    // Custom schemes from native clients.
    expect(
      isAllowedRedirectUri("cursor://anysphere.cursor-mcp/callback"),
    ).toBe(true);
    expect(isAllowedRedirectUri("vscode://x/y")).toBe(true);
    expect(isAllowedRedirectUri("claude://oauth/callback")).toBe(true);
  });

  it("refuses script-capable schemes", () => {
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("JaVaScRiPt:alert(1)")).toBe(false);
    // The URL parser strips leading whitespace, so this is still javascript:.
    expect(isAllowedRedirectUri(" javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("data:text/html,x")).toBe(false);
    expect(isAllowedRedirectUri("vbscript:x")).toBe(false);
    expect(isAllowedRedirectUri("blob:x")).toBe(false);
    expect(isAllowedRedirectUri("file:///etc/passwd")).toBe(false);
    expect(isAllowedRedirectUri("about:blank")).toBe(false);
  });

  it("refuses anything that isn't an absolute URI", () => {
    expect(isAllowedRedirectUri("")).toBe(false);
    expect(isAllowedRedirectUri("not a url")).toBe(false);
    expect(isAllowedRedirectUri("/relative")).toBe(false);
  });
});
