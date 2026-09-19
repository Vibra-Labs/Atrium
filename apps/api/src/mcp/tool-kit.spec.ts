import { describe, expect, it } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import * as z from "zod/v4";
import { defineTool, runTool, paging } from "./tool-kit";
import type { Actor } from "../common";

function actor(role: string): Actor {
  return {
    user: { id: "u1" }, organization: { id: "org1" }, member: { role },
  } as unknown as Actor;
}

describe("tool-kit", () => {
  it("wraps a successful result as JSON text", async () => {
    const tool = defineTool({
      name: "echo", description: "d", inputSchema: z.object({ a: z.string() }),
      handler: async (input, act) => ({ a: input.a, org: act.organization.id }),
    });
    const result = await runTool(tool, { a: "x" }, actor("admin"));
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ a: "x", org: "org1" });
  });

  it("maps HttpExceptions to isError with the original message", async () => {
    const tool = defineTool({
      name: "boom", description: "d", inputSchema: z.object({}),
      handler: async () => { throw new NotFoundException("Project not found"); },
    });
    const result = await runTool(tool, {}, actor("admin"));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Project not found");
  });

  it("hides unknown error details", async () => {
    const tool = defineTool({
      name: "boom", description: "d", inputSchema: z.object({}),
      handler: async () => { throw new Error("connection string leaked"); },
    });
    const result = await runTool(tool, {}, actor("admin"));
    expect(result.content[0].text).toBe("Internal error");
  });

  it("blocks ownerOnly tools for admins and allows owners", async () => {
    const tool = defineTool({
      name: "danger", description: "d", inputSchema: z.object({}), ownerOnly: true,
      handler: async () => "done",
    });
    expect((await runTool(tool, {}, actor("admin"))).isError).toBe(true);
    expect((await runTool(tool, {}, actor("owner"))).isError).toBeUndefined();
  });

  it("paging defaults to page 1, limit 20 and caps limit at 50", () => {
    const schema = z.object({ ...paging });
    expect(schema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(schema.safeParse({ limit: 51 }).success).toBe(false);
  });
});
