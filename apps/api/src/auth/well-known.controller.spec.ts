import { describe, expect, it, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { WellKnownController } from "./well-known.controller";

function build(values: Record<string, string>, withPlugin = true): WellKnownController {
  const api = withPlugin
    ? {
        getOAuthServerConfig: mock(() =>
          Promise.resolve({ issuer: "https://portal.test/api/auth", dpop_signing_alg_values_supported: ["ES256"] }),
        ),
      }
    : {};
  const config = { get: (key: string) => ({ API_URL: "https://portal.test", ...values })[key] };
  return new WellKnownController({ auth: { api } } as never, config as never);
}

describe("WellKnownController", () => {
  it("returns the plugin's authorization server metadata without DPoP", async () => {
    expect(await build({}).authorizationServer()).toEqual({ issuer: "https://portal.test/api/auth" });
  });

  it("describes the MCP endpoint as a protected resource", () => {
    expect(build({}).protectedResource()).toEqual({
      resource: "https://portal.test/api/mcp",
      authorization_servers: ["https://portal.test/api/auth"],
      bearer_methods_supported: ["header"],
    });
  });

  it("404s when OAuth is disabled, unusable, or the plugin is absent", async () => {
    await expect(build({ MCP_OAUTH_ENABLED: "false" }).authorizationServer()).rejects.toBeInstanceOf(NotFoundException);
    expect(() => build({ MCP_OAUTH_ENABLED: "false" }).protectedResource()).toThrow(NotFoundException);
    expect(() => build({ API_URL: "http://10.0.0.5:3001" }).protectedResource()).toThrow(NotFoundException);
    await expect(build({}, false).authorizationServer()).rejects.toBeInstanceOf(NotFoundException);
  });
});
