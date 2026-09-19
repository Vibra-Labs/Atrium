import { describe, expect, it, mock } from "bun:test";
import type { Request, Response } from "express";
import type { Actor } from "../common";
import { McpService } from "./mcp.service";

function buildConfig(oauthEnabled = "true", apiUrl = "https://portal.test") {
  return {
    get: (key: string, fallback?: string) =>
      key === "MCP_OAUTH_ENABLED" ? oauthEnabled : key === "API_URL" ? apiUrl : fallback,
  };
}

function buildService(oauthEnabled = "true", apiUrl?: string): McpService {
  const stub = {} as never;
  return new McpService(stub, stub, stub, stub, stub, stub, buildConfig(oauthEnabled, apiUrl) as never);
}

/**
 * Stands in for the transport half of `handle()` so the rate-limit branches can
 * be driven hundreds of times without constructing an MCP server per request.
 */
class TestMcpService extends McpService {
  served = 0;

  protected async serve(_actor: Actor, _req: Request, res: Response): Promise<void> {
    this.served += 1;
    res.status(200).json({ ok: true });
  }
}

function buildTestService(): TestMcpService {
  const stub = {} as never;
  return new TestMcpService(stub, stub, stub, stub, stub, stub, buildConfig() as never);
}

function ownerReq(apiKeyId?: string, userId = "u1"): Request {
  return {
    headers: {},
    user: { id: userId },
    organization: { id: "org1" },
    member: { role: "owner" },
    apiKeyId,
    bearerKind: apiKeyId ? "apiKey" : "oauth",
  } as unknown as Request;
}

/** A browser session: identity is present, but it came from a cookie. */
function cookieOwnerReq(): Request {
  return {
    headers: {},
    user: { id: "u1" },
    organization: { id: "org1" },
    member: { role: "owner" },
  } as unknown as Request;
}

function anonReq(authRateLimited = false): Request {
  return { headers: {}, authRateLimited } as unknown as Request;
}

function memberReq(userId = "u2"): Request {
  return {
    headers: {},
    user: { id: userId },
    organization: { id: "org1" },
    member: { role: "member" },
    bearerKind: "apiKey",
  } as unknown as Request;
}

function buildRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status: mock((code: number) => { res.statusCode = code; return res; }),
    set: mock((k: string, v: string) => { res.headers[k] = v; return res; }),
    json: mock((b: unknown) => { res.body = b; return res; }),
  };
  return res;
}

describe("McpService", () => {
  it("registers exactly the 19 documented tools, with unique names", () => {
    const names = buildService().tools().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual([
      "add_note", "archive_project", "create_project", "create_task", "delete_note",
      "delete_project", "delete_task", "get_client", "get_project", "get_workspace",
      "list_clients", "list_notes", "list_project_statuses", "list_projects", "list_tasks",
      "list_updates", "post_update", "update_project", "update_task",
    ]);
  });

  it("every tool has a description of at least 20 characters", () => {
    for (const tool of buildService().tools()) {
      expect(tool.description.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("responds 401 with a JSON-RPC error when the request has no identity", async () => {
    const res = buildRes();
    await buildService().handle({ headers: {} } as Request, res as unknown as Response);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
  });

  it("challenges with resource_metadata when OAuth is enabled", async () => {
    const res = buildRes();
    await buildService().handle({ headers: {} } as Request, res as unknown as Response);
    expect(res.statusCode).toBe(401);
    expect(res.headers["WWW-Authenticate"]).toBe(
      'Bearer resource_metadata="https://portal.test/.well-known/oauth-protected-resource"',
    );
  });

  it("trims a trailing slash from API_URL so the metadata URL is not doubled", async () => {
    const res = buildRes();
    await buildService("true", "https://portal.test/").handle({ headers: {} } as Request, res as unknown as Response);
    expect(res.headers["WWW-Authenticate"]).toBe(
      'Bearer resource_metadata="https://portal.test/.well-known/oauth-protected-resource"',
    );
  });

  it("falls back to a bare Bearer challenge when OAuth is disabled", async () => {
    const res = buildRes();
    await buildService("false").handle({ headers: {} } as Request, res as unknown as Response);
    expect(res.headers["WWW-Authenticate"]).toBe("Bearer");
  });

  it("responds 403 for a signed-in portal client", async () => {
    const res = buildRes();
    await buildService().handle(memberReq(), res as unknown as Response);
    expect(res.statusCode).toBe(403);
  });

  it("refuses cookie-session identity: the endpoint is bearer-only", async () => {
    // /api/mcp is @Public() and CSRF-exempt, and the tools change state, so a
    // browser session must not be able to drive it cross-site.
    const res = buildRes();
    await buildService().handle(cookieOwnerReq(), res as unknown as Response);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
    expect(res.headers["WWW-Authenticate"]).toBe(
      'Bearer resource_metadata="https://portal.test/.well-known/oauth-protected-resource"',
    );
  });

  it("serves both bearer kinds", async () => {
    const service = buildTestService();
    const viaKey = buildRes();
    await service.handle(ownerReq("k1"), viaKey as unknown as Response);
    expect(viaKey.statusCode).toBe(200);

    const viaOAuth = buildRes();
    await service.handle(ownerReq(undefined, "u9"), viaOAuth as unknown as Response);
    expect(viaOAuth.statusCode).toBe(200);
    expect(service.served).toBe(2);
  });

  it("rate limits an authenticated key once its 300/minute budget is spent", async () => {
    const service = buildTestService();
    for (let i = 0; i < 300; i++) {
      const res = buildRes();
      await service.handle(ownerReq("k1"), res as unknown as Response);
      expect(res.statusCode).toBe(200);
    }
    const res = buildRes();
    await service.handle(ownerReq("k1"), res as unknown as Response);
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBe("60");
    expect(res.body).toEqual({
      jsonrpc: "2.0",
      error: { code: -32029, message: "Rate limit exceeded. Retry in 60 seconds." },
      id: null,
    });
  });

  it("gives each API key of the same user its own budget", async () => {
    const service = buildTestService();
    for (let i = 0; i < 300; i++) {
      await service.handle(ownerReq("k1"), buildRes() as unknown as Response);
    }
    const exhausted = buildRes();
    await service.handle(ownerReq("k1"), exhausted as unknown as Response);
    expect(exhausted.statusCode).toBe(429);

    const other = buildRes();
    await service.handle(ownerReq("k2"), other as unknown as Response);
    expect(other.statusCode).toBe(200);
  });

  it("responds 429 when SessionMiddleware already rate limited the failed key", async () => {
    const res = buildRes();
    await buildService().handle(anonReq(true), res as unknown as Response);
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBe("60");
    expect(res.body).toEqual({
      jsonrpc: "2.0",
      error: { code: -32029, message: "Rate limit exceeded. Retry in 60 seconds." },
      id: null,
    });
  });

  it("responds 401 for an unauthenticated request that was not rate limited", async () => {
    const res = buildRes();
    await buildService().handle(anonReq(), res as unknown as Response);
    expect(res.statusCode).toBe(401);
  });

  it("charges the per-user bucket even when the role check refuses", async () => {
    const service = buildTestService();
    for (let i = 0; i < 300; i++) {
      const res = buildRes();
      await service.handle(memberReq(), res as unknown as Response);
      expect(res.statusCode).toBe(403);
    }
    const blocked = buildRes();
    await service.handle(memberReq(), blocked as unknown as Response);
    expect(blocked.statusCode).toBe(429);
  });
});
