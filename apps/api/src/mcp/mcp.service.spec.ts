import { describe, expect, it, mock } from "bun:test";
import type { Request, Response } from "express";
import { McpService } from "./mcp.service";

function buildService(): McpService {
  const stub = {} as never;
  return new McpService(stub, stub, stub, stub, stub, stub);
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
});
