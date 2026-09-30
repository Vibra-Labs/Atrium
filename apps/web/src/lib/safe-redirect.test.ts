import { describe, expect, it } from "bun:test";
import { isSafeOAuthRedirect } from "./safe-redirect";

describe("isSafeOAuthRedirect", () => {
  it("allows https, http loopback, and custom app schemes", () => {
    expect(isSafeOAuthRedirect("https://claude.ai/api/mcp/callback")).toBe(true);
    expect(isSafeOAuthRedirect("http://127.0.0.1:9999/callback")).toBe(true);
    expect(isSafeOAuthRedirect("cursor://anysphere.cursor-mcp/callback?code=x")).toBe(true);
    expect(isSafeOAuthRedirect("vscode://some.extension/callback")).toBe(true);
  });

  it("rejects script-capable and unsafe schemes", () => {
    expect(isSafeOAuthRedirect("javascript:alert(1)")).toBe(false);
    expect(isSafeOAuthRedirect("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isSafeOAuthRedirect(" javascript:alert(1)")).toBe(false);
    expect(isSafeOAuthRedirect("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeOAuthRedirect("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeOAuthRedirect("blob:https://claude.ai/uuid")).toBe(false);
    expect(isSafeOAuthRedirect("file:///etc/passwd")).toBe(false);
    expect(isSafeOAuthRedirect("about:blank")).toBe(false);
  });

  it("rejects empty, unparsable, and relative values", () => {
    // These are expected, routine inputs (untrusted redirect URIs), and the
    // helper logs every parse failure via console.error per project rules.
    // Suppress it here so the test output stays pristine.
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      expect(isSafeOAuthRedirect("")).toBe(false);
      expect(isSafeOAuthRedirect("not a url")).toBe(false);
      expect(isSafeOAuthRedirect("/dashboard")).toBe(false);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
