import { describe, expect, it, mock } from "bun:test";
import { documentTools } from "./documents.tools";
import { runTool } from "../tool-kit";
import type { Actor } from "../../common";

const admin = { user: { id: "u1" }, organization: { id: "org1" }, member: { role: "admin" } } as unknown as Actor;

describe("document tools", () => {
  it("list_pending_approvals is org-scoped and passes the optional project filter", async () => {
    const documents = { findPendingApprovals: mock(() => Promise.resolve([])) };
    const tool = documentTools({ documents: documents as never }).find((t) => t.name === "list_pending_approvals")!;

    await runTool(tool, tool.inputSchema.parse({}), admin);
    await runTool(tool, tool.inputSchema.parse({ projectId: "p1" }), admin);

    expect(documents.findPendingApprovals).toHaveBeenNthCalledWith(1, "org1", undefined);
    expect(documents.findPendingApprovals).toHaveBeenNthCalledWith(2, "org1", "p1");
  });
});
