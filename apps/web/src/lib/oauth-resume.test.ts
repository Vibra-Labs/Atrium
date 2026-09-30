import { describe, expect, it } from "bun:test";
import { oauthResumeUrl } from "./oauth-resume";

describe("oauthResumeUrl", () => {
  it("returns null for a normal login", () => {
    expect(oauthResumeUrl("", "https://api.test")).toBeNull();
    expect(oauthResumeUrl("?redirect=/dashboard", "https://api.test")).toBeNull();
    expect(oauthResumeUrl("?client_id=abc", "https://api.test")).toBeNull();
  });

  it("rebuilds the authorize URL with the original query", () => {
    const search = "?response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s&code_challenge=x&code_challenge_method=S256";
    expect(oauthResumeUrl(search, "https://api.test")).toBe(
      `https://api.test/api/auth/mcp/authorize${search}`,
    );
  });

  it("works with a same-origin API (empty apiUrl)", () => {
    expect(oauthResumeUrl("?response_type=code&client_id=abc", "")).toBe(
      "/api/auth/mcp/authorize?response_type=code&client_id=abc",
    );
  });
});
