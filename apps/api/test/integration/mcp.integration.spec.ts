/**
 * Drives the real MCP endpoint with the official SDK client over HTTP, against
 * a real database: key → SessionMiddleware → McpService → ProjectsService →
 * Postgres. The unit tests mock every one of those seams.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ApiKeysService } from "../../src/api-keys/api-keys.service";
import { SessionMiddleware } from "../../src/auth/session.middleware";
import { McpService } from "../../src/mcp/mcp.service";
import { ProjectsService } from "../../src/projects/projects.service";
import { NotesService } from "../../src/notes/notes.service";
import { TasksService } from "../../src/tasks/tasks.service";
import { UpdatesService } from "../../src/updates/updates.service";
import { ClientsService } from "../../src/clients/clients.service";
import type { AuthService } from "../../src/auth/auth.service";
import type { BillingService } from "../../src/billing/billing.service";

let prisma: PrismaService;
let apiKeys: ApiKeysService;
let server: Server;
let url: URL;
let orgId: string;
let adminKey: string;
let clients: ClientsService;

const stamp = `${Date.now()}`;

async function connect(key: string): Promise<Client> {
  const client = new Client({ name: "integration", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  await client.connect(transport);
  return client;
}

/**
 * `Project.organizationId` is a plain column, not a Prisma relation, so deleting
 * the organization leaves its projects (and everything cascading off them)
 * behind. Invoice is the only child of Project that does not cascade, so its
 * rows are removed first.
 */
async function purgeOrg(organizationId: string): Promise<void> {
  await prisma.invoice.deleteMany({ where: { organizationId } });
  await prisma.project.deleteMany({ where: { organizationId } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
}

function textOf(result: { content?: unknown }): string {
  const content = result.content as { type: string; text: string }[];
  return content[0].text;
}

beforeAll(async () => {
  assertDisposableDatabase();
  prisma = new PrismaService();
  await prisma.$connect();

  orgId = `org-${stamp}`;
  await prisma.organization.create({ data: { id: orgId, name: "MCP Test Org", slug: `mcp-${stamp}` } });
  await prisma.user.create({ data: { id: `admin-${stamp}`, name: "Admin", email: `admin-${stamp}@test.com` } });
  await prisma.member.create({ data: { id: `m-${stamp}`, organizationId: orgId, userId: `admin-${stamp}`, role: "admin" } });

  apiKeys = new ApiKeysService(prisma);
  const created = await apiKeys.create("integration", `admin-${stamp}`, orgId);
  adminKey = created.key;

  const authStub = { auth: { api: { getSession: async () => null } } } as unknown as AuthService;
  const billingStub = { assertPlanLimit: async () => undefined } as unknown as BillingService;
  const mcpAuthStub = { resolve: async () => null } as never;
  const configStub = { get: (_k: string, fallback?: string) => fallback } as never;
  // Notifications, activity logging, storage and the logger are side effects
  // the tools do not depend on; every method is a resolved no-op.
  const noop = new Proxy({}, { get: () => () => Promise.resolve() }) as never;
  clients = new ClientsService(prisma, {} as never);
  const middleware = new SessionMiddleware(authStub, apiKeys, mcpAuthStub, configStub);
  const mcp = new McpService(
    new ProjectsService(prisma),
    new TasksService(prisma, noop, noop, noop),
    new UpdatesService(prisma, noop, noop, noop),
    new NotesService(prisma),
    clients,
    billingStub,
    configStub,
  );

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use((req, res, next) => void middleware.use(req, res, next));
  app.post("/api/mcp", (req, res) => void mcp.handle(req, res));

  server = app.listen(0);
  url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`);
});

afterAll(async () => {
  server?.close();
  await purgeOrg(orgId);
  await prisma.user.deleteMany({ where: { id: { in: [`admin-${stamp}`, `client-${stamp}`] } } });
  await prisma.$disconnect();
});

describe("MCP endpoint", () => {
  it("lists tools for a valid key", async () => {
    const client = await connect(adminKey);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("create_project");
    expect(tools.length).toBe(19);
    await client.close();
  });

  it("create_project writes to Postgres in the key's org, and list_projects reads it back", async () => {
    const client = await connect(adminKey);

    const created = await client.callTool({ name: "create_project", arguments: { name: `MCP Project ${stamp}` } });
    expect(created.isError).toBeFalsy();
    const projectId: string = JSON.parse(textOf(created)).id;

    const row = await prisma.project.findUnique({ where: { id: projectId } });
    expect(row?.organizationId).toBe(orgId);

    const listed = await client.callTool({ name: "list_projects", arguments: { search: stamp } });
    expect(JSON.parse(textOf(listed)).data.map((p: { id: string }) => p.id)).toContain(projectId);

    await client.callTool({ name: "add_note", arguments: { projectId, content: "from mcp" } });
    expect(await prisma.projectNote.count({ where: { projectId, authorId: `admin-${stamp}` } })).toBe(1);
    await client.close();
  });

  it("cannot read another org's project", async () => {
    await prisma.organization.create({ data: { id: `other-${stamp}`, name: "Other", slug: `other-${stamp}` } });
    const foreign = await prisma.project.create({ data: { name: "Secret", organizationId: `other-${stamp}` } });
    const client = await connect(adminKey);

    const result = await client.callTool({ name: "get_project", arguments: { projectId: foreign.id } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Project not found");
    await client.close();
    await purgeOrg(`other-${stamp}`);
  });

  it("blocks delete_project for an admin", async () => {
    const client = await connect(adminKey);
    const project = await prisma.project.create({ data: { name: "Keep me", organizationId: orgId } });
    const result = await client.callTool({ name: "delete_project", arguments: { projectId: project.id } });
    expect(result.isError).toBe(true);
    expect(await prisma.project.count({ where: { id: project.id } })).toBe(1);
    await client.close();
  });

  it("refuses a JSON-RPC batch and runs none of its messages", async () => {
    const batchName = `Batch ${stamp}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${adminKey}`,
      },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_project", arguments: { name: batchName } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_project", arguments: { name: batchName } } },
      ]),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32600,
        message: "Batch requests are not supported. Send one JSON-RPC message per request.",
      },
      id: null,
    });
    expect(await prisma.project.count({ where: { organizationId: orgId, name: batchName } })).toBe(0);
  });

  it("update_project and archive_project change the row, and archived projects leave the default list", async () => {
    const client = await connect(adminKey);
    const project = await prisma.project.create({ data: { name: "Before", organizationId: orgId } });

    const updated = await client.callTool({
      name: "update_project",
      arguments: { projectId: project.id, name: `After ${stamp}`, description: "edited" },
    });
    expect(updated.isError).toBeFalsy();
    const row = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(row.name).toBe(`After ${stamp}`);
    expect(row.description).toBe("edited");

    const archived = await client.callTool({ name: "archive_project", arguments: { projectId: project.id, archived: true } });
    expect(archived.isError).toBeFalsy();
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).archivedAt).not.toBeNull();
    const active = await client.callTool({ name: "list_projects", arguments: { search: `After ${stamp}` } });
    expect(JSON.parse(textOf(active)).data).toHaveLength(0);

    await client.callTool({ name: "archive_project", arguments: { projectId: project.id, archived: false } });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).archivedAt).toBeNull();
    await client.close();
  });

  it("task tools create, list, update and delete tasks in Postgres", async () => {
    const client = await connect(adminKey);
    const project = await prisma.project.create({ data: { name: "Tasks", organizationId: orgId } });

    const created = await client.callTool({
      name: "create_task",
      arguments: { projectId: project.id, title: "Write tests" },
    });
    expect(created.isError).toBeFalsy();
    const taskId: string = JSON.parse(textOf(created)).id;
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).projectId).toBe(project.id);

    const listed = await client.callTool({ name: "list_tasks", arguments: { projectId: project.id } });
    expect(textOf(listed)).toContain(taskId);

    const updated = await client.callTool({
      name: "update_task",
      arguments: { taskId, status: "done", assigneeId: `admin-${stamp}` },
    });
    expect(updated.isError).toBeFalsy();
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.status).toBe("done");
    expect(row.assigneeId).toBe(`admin-${stamp}`);

    const deleted = await client.callTool({ name: "delete_task", arguments: { taskId } });
    expect(deleted.isError).toBeFalsy();
    expect(await prisma.task.count({ where: { id: taskId } })).toBe(0);
    await client.close();
  });

  it("post_update and list_updates write and read project updates", async () => {
    const client = await connect(adminKey);
    const project = await prisma.project.create({ data: { name: "Updates", organizationId: orgId } });

    const posted = await client.callTool({
      name: "post_update",
      arguments: { projectId: project.id, content: "Shipped the thing" },
    });
    expect(posted.isError).toBeFalsy();
    expect(await prisma.projectUpdate.count({ where: { projectId: project.id } })).toBe(1);

    const listed = await client.callTool({ name: "list_updates", arguments: { projectId: project.id } });
    expect(textOf(listed)).toContain("Shipped the thing");
    await client.close();
  });

  it("list_clients and get_client return this workspace's clients only", async () => {
    await prisma.user.create({ data: { id: `client-${stamp}`, name: "Client Person", email: `client-${stamp}@test.com` } });
    await prisma.member.create({ data: { id: `mc-${stamp}`, organizationId: orgId, userId: `client-${stamp}`, role: "member" } });
    const client = await connect(adminKey);

    const listed = await client.callTool({ name: "list_clients", arguments: { search: `client-${stamp}` } });
    expect(listed.isError).toBeFalsy();
    expect(textOf(listed)).toContain(`client-${stamp}@test.com`);

    const one = await client.callTool({ name: "get_client", arguments: { clientUserId: `client-${stamp}` } });
    expect(one.isError).toBeFalsy();
    expect(textOf(one)).toContain("Client Person");

    const foreign = await client.callTool({ name: "get_client", arguments: { clientUserId: "not-a-member" } });
    expect(foreign.isError).toBe(true);
    await client.close();
  });

  it("a key does not come back after its owner is demoted then re-promoted, or removed then re-added", async () => {
    await prisma.user.create({ data: { id: `second-${stamp}`, name: "Second", email: `second-${stamp}@test.com` } });
    await prisma.member.create({ data: { id: `m2-${stamp}`, organizationId: orgId, userId: `second-${stamp}`, role: "admin" } });

    const demoted = await apiKeys.create("demote", `second-${stamp}`, orgId);
    await clients.changeRole(`m2-${stamp}`, "member", orgId, `admin-${stamp}`);
    await clients.changeRole(`m2-${stamp}`, "admin", orgId, `admin-${stamp}`);
    expect(await apiKeys.resolve(demoted.key)).toBeNull();

    const removed = await apiKeys.create("remove", `second-${stamp}`, orgId);
    expect(await apiKeys.resolve(removed.key)).not.toBeNull();
    await prisma.member.delete({ where: { id: `m2-${stamp}` } });
    await prisma.member.create({ data: { id: `m3-${stamp}`, organizationId: orgId, userId: `second-${stamp}`, role: "admin" } });
    expect(await apiKeys.resolve(removed.key)).toBeNull();

    await prisma.user.deleteMany({ where: { id: `second-${stamp}` } });
  });

  it("rejects requests with no key and with a revoked key", async () => {
    const noKey = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(noKey.status).toBe(401);
    expect(noKey.headers.get("www-authenticate")).toStartWith("Bearer");

    const fresh = await apiKeys.create("to-revoke", `admin-${stamp}`, orgId);
    await apiKeys.revoke(fresh.id, orgId);
    await expect(connect(fresh.key)).rejects.toThrow();
  });
});
