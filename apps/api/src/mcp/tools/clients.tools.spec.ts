import { describe, expect, it, mock } from "bun:test";
import { clientTools } from "./clients.tools";
import { runTool } from "../tool-kit";
import type { Actor } from "../../common";

const admin = { user: { id: "u1" }, organization: { id: "org1" }, member: { role: "admin" } } as unknown as Actor;

function build() {
  const clients = {
    list: mock(() => Promise.resolve({ data: [], meta: {} })),
    findMember: mock(() => Promise.resolve({ userId: "u2", role: "member", user: { name: "Bob" } })),
    getProfile: mock(() => Promise.resolve({ company: "Globex" })),
  };
  const projects = { findByClient: mock(() => Promise.resolve({ data: [{ id: "p1" }], meta: {} })) };
  const tools = clientTools({ clients: clients as never, projects: projects as never });
  return { clients, projects, get: (n: string) => tools.find((t) => t.name === n)! };
}

describe("client tools", () => {
  it("list_clients forwards paging and search", async () => {
    const { clients, get } = build();
    const input = get("list_clients").inputSchema.parse({ search: "glo" });
    await runTool(get("list_clients"), input, admin);
    expect(clients.list).toHaveBeenCalledWith("org1", 1, 20, "glo");
  });

  it("get_client combines member, profile, and projects", async () => {
    const { clients, projects, get } = build();
    const result = await runTool(get("get_client"), { clientUserId: "u2" }, admin);
    expect(clients.findMember).toHaveBeenCalledWith("u2", "org1");
    expect(projects.findByClient).toHaveBeenCalledWith("u2", "org1", { page: 1, limit: 50 });
    expect(JSON.parse(result.content[0].text)).toEqual({
      member: { userId: "u2", role: "member", user: { name: "Bob" } },
      profile: { company: "Globex" },
      projects: [{ id: "p1" }],
    });
  });
});
