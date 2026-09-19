import { describe, expect, it, mock } from "bun:test";
import { noteTools } from "./notes.tools";
import { runTool } from "../tool-kit";
import type { Actor } from "../../common";

const admin = { user: { id: "u1" }, organization: { id: "org1" }, member: { role: "admin" } } as unknown as Actor;

function build() {
  const notes = {
    findByProject: mock(() => Promise.resolve({ data: [], meta: {} })),
    create: mock(() => Promise.resolve({ id: "n1" })),
    remove: mock(() => Promise.resolve()),
  };
  const tools = noteTools({ notes: notes as never });
  return { notes, get: (n: string) => tools.find((t) => t.name === n)! };
}

describe("note tools", () => {
  it("add_note authors the note as the acting user", async () => {
    const { notes, get } = build();
    await runTool(get("add_note"), { projectId: "p1", content: "Client prefers email" }, admin);
    expect(notes.create).toHaveBeenCalledWith("Client prefers email", "p1", "org1", "u1");
  });

  it("list_notes and delete_note are scoped to the org", async () => {
    const { notes, get } = build();
    await runTool(get("list_notes"), get("list_notes").inputSchema.parse({ projectId: "p1" }), admin);
    await runTool(get("delete_note"), { noteId: "n1" }, admin);
    expect(notes.findByProject).toHaveBeenCalledWith("p1", "org1", 1, 20);
    expect(notes.remove).toHaveBeenCalledWith("n1", "org1");
  });
});
