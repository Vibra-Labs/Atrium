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
import type { AuthService } from "../../src/auth/auth.service";
import type { BillingService } from "../../src/billing/billing.service";

let prisma: PrismaService;
let apiKeys: ApiKeysService;
let server: Server;
let url: URL;
let orgId: string;
let adminKey: string;

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
  const middleware = new SessionMiddleware(authStub, apiKeys, mcpAuthStub);
  const unused = {} as never;
  const configStub = { get: (_k: string, fallback?: string) => fallback } as never;
  const mcp = new McpService(
    new ProjectsService(prisma), unused, unused, new NotesService(prisma), unused, billingStub, configStub,
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
  await prisma.user.deleteMany({ where: { id: `admin-${stamp}` } });
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

  it("rejects requests with no key and with a revoked key", async () => {
    const noKey = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(noKey.status).toBe(401);
    expect(noKey.headers.get("www-authenticate")).toStartWith("Bearer");

    const fresh = await apiKeys.create("to-revoke", `admin-${stamp}`, orgId);
    await apiKeys.revoke(fresh.id, orgId);
    await expect(connect(fresh.key)).rejects.toThrow();
  });
});
