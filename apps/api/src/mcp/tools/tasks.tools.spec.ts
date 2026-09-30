import { describe, expect, it, mock } from "bun:test";
import { taskTools } from "./tasks.tools";
import { runTool } from "../tool-kit";
import type { Actor } from "../../common";

const admin = { user: { id: "u1" }, organization: { id: "org1" }, member: { role: "admin" } } as unknown as Actor;

function build() {
  const tasks = {
    findByProject: mock(() => Promise.resolve({ data: [], meta: {} })),
    create: mock(() => Promise.resolve({ id: "t1" })),
    update: mock(() => Promise.resolve({ id: "t1" })),
    remove: mock(() => Promise.resolve()),
  };
  const tools = taskTools({ tasks: tasks as never });
  return { tasks, get: (n: string) => tools.find((t) => t.name === n)! };
}

describe("task tools", () => {
  it("list_tasks defaults to active tasks", async () => {
    const { tasks, get } = build();
    const input = get("list_tasks").inputSchema.parse({ projectId: "p1" });
    await runTool(get("list_tasks"), input, admin);
    expect(tasks.findByProject).toHaveBeenCalledWith("p1", "org1", 1, 20, "active");
  });

  it("create_task separates projectId from the task fields", async () => {
    const { tasks, get } = build();
    await runTool(get("create_task"), { projectId: "p1", title: "Ship", dueDate: "2026-10-01" }, admin);
    expect(tasks.create).toHaveBeenCalledWith({ title: "Ship", dueDate: "2026-10-01" }, "p1", "org1");
  });

  it("update_task passes null to clear dueDate and assignee", async () => {
    const { tasks, get } = build();
    const input = get("update_task").inputSchema.parse({ taskId: "t1", dueDate: null, assigneeId: null, status: "done" });
    await runTool(get("update_task"), input, admin);
    expect(tasks.update).toHaveBeenCalledWith("t1", { dueDate: null, assigneeId: null, status: "done" }, "org1");
  });

  it("update_task rejects unknown statuses", () => {
    expect(build().get("update_task").inputSchema.safeParse({ taskId: "t1", status: "blocked" }).success).toBe(false);
  });

  it("delete_task removes within the actor's org", async () => {
    const { tasks, get } = build();
    await runTool(get("delete_task"), { taskId: "t1" }, admin);
    expect(tasks.remove).toHaveBeenCalledWith("t1", "org1");
  });
});

describe("task tool date validation", () => {
  it("rejects prose dates and accepts ISO dates", () => {
    const { get } = build();
    const schema = get("create_task").inputSchema;
    expect(schema.safeParse({ projectId: "p1", title: "Ship", dueDate: "next friday" }).success).toBe(false);
    expect(schema.safeParse({ projectId: "p1", title: "Ship", dueDate: "2026-10-01" }).success).toBe(true);
    expect(schema.safeParse({ projectId: "p1", title: "Ship", dueDate: "2026-10-01T12:00:00Z" }).success).toBe(true);
  });

  it("still accepts null for update_task.dueDate", () => {
    const { get } = build();
    const schema = get("update_task").inputSchema;
    expect(schema.safeParse({ taskId: "t1", dueDate: null }).success).toBe(true);
    expect(schema.safeParse({ taskId: "t1", dueDate: "tomorrow" }).success).toBe(false);
  });
});

describe("blank task titles are refused, not stored", () => {
  it("create_task rejects a whitespace-only title and trims a padded one", () => {
    const schema = build().get("create_task").inputSchema;
    expect(schema.safeParse({ projectId: "p1", title: "   " }).success).toBe(false);
    const parsed = schema.safeParse({ projectId: "p1", title: "  Ship it  " });
    expect(parsed.success).toBe(true);
    expect((parsed.data as { title: string }).title).toBe("Ship it");
  });

  it("update_task rejects a whitespace-only title", () => {
    const schema = build().get("update_task").inputSchema;
    expect(schema.safeParse({ taskId: "t1", title: " " }).success).toBe(false);
  });
});
