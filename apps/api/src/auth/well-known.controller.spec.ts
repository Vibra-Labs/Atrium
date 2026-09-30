import { describe, expect, it, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { WellKnownController } from "./well-known.controller";

function build(enabled: string, withPlugin = true) {
  const api = withPlugin
    ? {
        getMcpOAuthConfig: mock(() => Promise.resolve({ issuer: "https://portal.test" })),
        getMCPProtectedResource: mock(() => Promise.resolve({ resource: "https://portal.test/api/mcp" })),
      }
    : {};
  const config = { get: (_k: string, fallback?: string) => enabled ?? fallback };
  return new WellKnownController({ auth: { api } } as never, config as never);
}

describe("WellKnownController", () => {
  it("returns the plugin's metadata documents", async () => {
    const controller = build("true");
    expect(await controller.authorizationServer()).toEqual({ issuer: "https://portal.test" });
    expect(await controller.protectedResource()).toEqual({ resource: "https://portal.test/api/mcp" });
  });

  it("404s when OAuth is disabled or the plugin is absent", async () => {
    await expect(build("false").authorizationServer()).rejects.toBeInstanceOf(NotFoundException);
    await expect(build("true", false).protectedResource()).rejects.toBeInstanceOf(NotFoundException);
  });
});
