import { describe, expect, it, mock } from "bun:test";
import type { Request, Response } from "express";
import type { Actor } from "../common";
import { McpService } from "./mcp.service";

function buildService(): McpService {
  const stub = {} as never;
  return new McpService(stub, stub, stub, stub, stub, stub);
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
  return new TestMcpService(stub, stub, stub, stub, stub, stub);
}

function ownerReq(apiKeyId?: string, userId = "u1"): Request {
  return {
    headers: {},
    user: { id: userId },
    organization: { id: "org1" },
    member: { role: "owner" },
    apiKeyId,
  } as unknown as Request;
}

function anonReq(ip: string): Request {
  return { headers: {}, ip } as unknown as Request;
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

  it("responds 401 with WWW-Authenticate when the request has no identity", async () => {
    const res = buildRes();
    await buildService().handle({ headers: {} } as Request, res as unknown as Response);
    expect(res.statusCode).toBe(401);
    expect(res.headers["WWW-Authenticate"]).toBe("Bearer");
    expect(res.body).toEqual({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
  });

  it("responds 403 for a signed-in portal client", async () => {
    const res = buildRes();
    const req = { headers: {}, user: { id: "u2" }, organization: { id: "org1" }, member: { role: "member" } };
    await buildService().handle(req as unknown as Request, res as unknown as Response);
    expect(res.statusCode).toBe(403);
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

  it("rate limits unauthenticated requests per IP after 30 in a minute", async () => {
    const service = buildTestService();
    for (let i = 0; i < 30; i++) {
      const res = buildRes();
      await service.handle(anonReq("1.2.3.4"), res as unknown as Response);
      expect(res.statusCode).toBe(401);
    }
    const blocked = buildRes();
    await service.handle(anonReq("1.2.3.4"), blocked as unknown as Response);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["Retry-After"]).toBe("60");

    const otherIp = buildRes();
    await service.handle(anonReq("5.6.7.8"), otherIp as unknown as Response);
    expect(otherIp.statusCode).toBe(401);
  });

  it("does not let authenticated requests consume the unauthenticated budget", async () => {
    const service = buildTestService();
    for (let i = 0; i < 40; i++) {
      await service.handle(ownerReq("k1"), buildRes() as unknown as Response);
    }
    const anon = buildRes();
    await service.handle(anonReq("1.2.3.4"), anon as unknown as Response);
    expect(anon.statusCode).toBe(401);
  });
});
