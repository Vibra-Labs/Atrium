import { describe, expect, it, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { projectTools } from "./projects.tools";
import { workspaceTools } from "./workspace.tools";
import { runTool } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { Actor } from "../../common";

const owner = {
  user: { id: "u1", name: "Ada", email: "a@t.co" },
  organization: { id: "org1", name: "Acme", slug: "acme" },
  member: { role: "owner" },
} as unknown as Actor;
const admin = { ...owner, member: { role: "admin" } } as unknown as Actor;

function build() {
  const projects = {
    findAll: mock(() => Promise.resolve({ data: [], meta: {} })),
    findOne: mock(() => Promise.resolve({ id: "p1" })),
    create: mock(() => Promise.resolve({ id: "p1", name: "Site" })),
    update: mock(() => Promise.resolve({ id: "p1" })),
    archive: mock(() => Promise.resolve({ id: "p1" })),
    unarchive: mock(() => Promise.resolve({ id: "p1" })),
    remove: mock(() => Promise.resolve()),
    getStatuses: mock(() => Promise.resolve([])),
  };
  const billing = { assertPlanLimit: mock(() => Promise.resolve()) };
  const tools = projectTools({ projects: projects as never, billing: billing as never });
  const get = (name: string): McpTool => tools.find((t) => t.name === name)!;
  return { projects, billing, tools, get };
}

describe("project tools", () => {
  it("exposes the expected tool names", () => {
    expect(build().tools.map((t) => t.name).sort()).toEqual([
      "archive_project", "create_project", "delete_project", "get_project",
      "list_project_statuses", "list_projects", "update_project",
    ]);
  });

  it("list_projects passes filters and the actor's org", async () => {
    const { projects, get } = build();
    const input = get("list_projects").inputSchema.parse({ search: "site", archived: true });
    await runTool(get("list_projects"), input, admin);
    expect(projects.findAll).toHaveBeenCalledWith("org1", {
      page: 1, limit: 20, search: "site", status: undefined, archived: "true",
    });
  });

  it("create_project checks the plan limit, then creates in the actor's org", async () => {
    const { projects, billing, get } = build();
    const result = await runTool(get("create_project"), { name: "Site" }, admin);
    expect(billing.assertPlanLimit).toHaveBeenCalledWith("org1", "projects");
    expect(projects.create).toHaveBeenCalledWith({ name: "Site" }, "org1");
    expect(JSON.parse(result.content[0].text).id).toBe("p1");
  });

  it("update_project separates the id from the patch", async () => {
    const { projects, get } = build();
    await runTool(get("update_project"), { projectId: "p1", status: "done" }, admin);
    expect(projects.update).toHaveBeenCalledWith("p1", { status: "done" }, "org1");
  });

  it("archive_project routes to archive or unarchive", async () => {
    const { projects, get } = build();
    await runTool(get("archive_project"), { projectId: "p1", archived: true }, admin);
    await runTool(get("archive_project"), { projectId: "p1", archived: false }, admin);
    expect(projects.archive).toHaveBeenCalledWith("p1", "org1");
    expect(projects.unarchive).toHaveBeenCalledWith("p1", "org1");
  });

  it("delete_project is owner-only", async () => {
    const { projects, get } = build();
    expect((await runTool(get("delete_project"), { projectId: "p1" }, admin)).isError).toBe(true);
    expect(projects.remove).not.toHaveBeenCalled();
    await runTool(get("delete_project"), { projectId: "p1" }, owner);
    expect(projects.remove).toHaveBeenCalledWith("p1", "org1");
  });

  it("surfaces NotFound from the service", async () => {
    const { projects, get } = build();
    projects.findOne.mockImplementation(() => Promise.reject(new NotFoundException("Project not found")));
    const result = await runTool(get("get_project"), { projectId: "zzz" }, admin);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Project not found");
  });

  it("create_project rejects names over 255 chars", () => {
    expect(build().get("create_project").inputSchema.safeParse({ name: "x".repeat(256) }).success).toBe(false);
  });
});

describe("workspace tools", () => {
  it("get_workspace describes the org and acting user", async () => {
    const tool = workspaceTools()[0];
    const result = await runTool(tool, {}, owner);
    expect(JSON.parse(result.content[0].text)).toEqual({
      workspace: { id: "org1", name: "Acme", slug: "acme" },
      actingAs: { id: "u1", name: "Ada", email: "a@t.co", role: "owner" },
    });
  });
});

describe("project tool date validation", () => {
  it("rejects prose dates and accepts ISO dates", () => {
    const { get } = build();
    const schema = get("create_project").inputSchema;
    expect(schema.safeParse({ name: "Site", startDate: "next friday" }).success).toBe(false);
    expect(schema.safeParse({ name: "Site", startDate: "2026-10-01" }).success).toBe(true);
    expect(schema.safeParse({ name: "Site", endDate: "2026-10-01T12:00:00Z" }).success).toBe(true);
  });
});
