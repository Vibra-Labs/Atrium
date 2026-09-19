import { describe, expect, it } from "bun:test";
import { isMcpPath } from "./mcp-path";

describe("isMcpPath", () => {
  it("matches the MCP endpoint", () => {
    expect(isMcpPath("/api/mcp")).toBe(true);
  });

  it("matches one trailing slash, which Express routes to the same handler", () => {
    expect(isMcpPath("/api/mcp/")).toBe(true);
  });

  it("ignores the query string", () => {
    expect(isMcpPath("/api/mcp?x=1")).toBe(true);
    expect(isMcpPath("/api/mcp/?x=1")).toBe(true);
    expect(isMcpPath("/api/mcp-grants?x=1")).toBe(false);
  });

  it("does not match sub-paths, prefix look-alikes or a doubled slash", () => {
    for (const path of [
      "/api/mcp/x",
      "/api/mcp/x/",
      "/api/mcpx",
      "/api/mcp-grants",
      "/api/mcp//",
      "/api/mcp/extra",
      "api/mcp",
      "/mcp",
      "",
    ]) {
      expect(isMcpPath(path)).toBe(false);
    }
  });

  it("is case sensitive", () => {
    expect(isMcpPath("/api/MCP")).toBe(false);
    expect(isMcpPath("/API/mcp")).toBe(false);
  });
});
