import { describe, expect, it, mock } from "bun:test";
import { updateTools } from "./updates.tools";
import { runTool } from "../tool-kit";
import type { Actor } from "../../common";

const admin = { user: { id: "u1" }, organization: { id: "org1" }, member: { role: "admin" } } as unknown as Actor;

function build() {
  const updates = {
    findByProject: mock(() => Promise.resolve({ data: [], meta: {} })),
    create: mock(() => Promise.resolve({ id: "up1" })),
  };
  const tools = updateTools({ updates: updates as never });
  return { updates, get: (n: string) => tools.find((t) => t.name === n)! };
}

describe("update tools", () => {
  it("list_updates pages through a project's updates", async () => {
    const { updates, get } = build();
    const input = get("list_updates").inputSchema.parse({ projectId: "p1", page: 2 });
    await runTool(get("list_updates"), input, admin);
    expect(updates.findByProject).toHaveBeenCalledWith("p1", "org1", 2, 20);
  });

  it("post_update authors the update as the acting user", async () => {
    const { updates, get } = build();
    await runTool(get("post_update"), { projectId: "p1", content: "Shipped v2" }, admin);
    expect(updates.create).toHaveBeenCalledWith({ content: "Shipped v2" }, "p1", "org1", "u1", "admin");
  });

  it("post_update rejects empty and oversized content", () => {
    const schema = build().get("post_update").inputSchema;
    expect(schema.safeParse({ projectId: "p1", content: "" }).success).toBe(false);
    expect(schema.safeParse({ projectId: "p1", content: "x".repeat(5001) }).success).toBe(false);
  });
});

describe("blank update content is refused, not stored", () => {
  it("post_update rejects whitespace-only content and trims padded content", () => {
    const schema = build().get("post_update").inputSchema;
    expect(schema.safeParse({ projectId: "p1", content: "  \n " }).success).toBe(false);
    const parsed = schema.safeParse({ projectId: "p1", content: "  Shipped  " });
    expect(parsed.success).toBe(true);
    expect((parsed.data as { content: string }).content).toBe("Shipped");
  });
});
