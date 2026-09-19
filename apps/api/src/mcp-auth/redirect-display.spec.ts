import { describe, expect, it } from "bun:test";
import { describeRedirect } from "./redirect-display";

describe("describeRedirect", () => {
  it("shows the host for a remote web destination", () => {
    expect(describeRedirect("https://claude.ai/api/mcp/auth_callback")).toEqual({
      display: "claude.ai",
      kind: "web",
    });
    expect(describeRedirect("http://portal.example.com:8080/cb")).toEqual({
      display: "portal.example.com",
      kind: "web",
    });
  });

  it("calls every loopback address an app on this computer", () => {
    for (const uri of [
      "http://localhost:9999/callback",
      "http://127.0.0.1:1455/oauth/callback",
      "http://[::1]:3000/cb",
    ]) {
      expect(describeRedirect(uri)).toEqual({
        display: "an app on this computer",
        kind: "local",
      });
    }
  });

  it("shows the scheme for a native client", () => {
    expect(describeRedirect("cursor://anysphere.cursor-mcp/callback")).toEqual({
      display: "cursor://",
      kind: "app",
    });
    expect(describeRedirect("VSCode://ms/cb")).toEqual({ display: "vscode://", kind: "app" });
  });

  it("never echoes a URI it cannot parse", () => {
    const described = describeRedirect("not a url");
    expect(described).toEqual({ display: "an unknown destination", kind: "app" });
  });
});
