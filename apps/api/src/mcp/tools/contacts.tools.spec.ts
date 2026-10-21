import { describe, expect, it, mock } from "bun:test";
import { contactTools } from "./contacts.tools";
import { runTool } from "../tool-kit";
import type { Actor } from "../../common";

const admin = { user: { id: "u1" }, organization: { id: "org1" }, member: { role: "admin" } } as unknown as Actor;

function build() {
  const contacts = {
    findAll: mock(() => Promise.resolve({ data: [], meta: {} })),
    findOne: mock(() => Promise.resolve({ id: "c1" })),
    addNote: mock(() => Promise.resolve({ id: "n1" })),
  };
  const tools = contactTools({ contacts: contacts as never });
  return { contacts, get: (n: string) => tools.find((t) => t.name === n)! };
}

describe("contact tools", () => {
  it("list_contacts passes filters and paging, scoped to the org", async () => {
    const { contacts, get } = build();
    const input = get("list_contacts").inputSchema.parse({ search: "ann", status: "lead" });
    await runTool(get("list_contacts"), input, admin);
    expect(contacts.findAll).toHaveBeenCalledWith("org1", { search: "ann", status: "lead", page: 1, limit: 20 });
  });

  it("list_contacts passes a rating filter and rejects an unknown one", async () => {
    const { contacts, get } = build();
    const schema = get("list_contacts").inputSchema;
    expect(schema.safeParse({ rating: "lukewarm" }).success).toBe(false);
    await runTool(get("list_contacts"), schema.parse({ rating: "hot" }), admin);
    expect(contacts.findAll).toHaveBeenCalledWith("org1", { rating: "hot", page: 1, limit: 20 });
  });

  it("get_contact returns the contact fields from the service", async () => {
    const { contacts, get } = build();
    const contact = {
      id: "c1",
      firstName: "Ann",
      lastName: "Lee",
      jobTitle: "CTO",
      department: "Eng",
      phones: [{ label: "Mobile", number: "555" }],
      socialLinks: ["https://x.com/ann"],
      rating: "hot",
    };
    contacts.findOne.mockImplementationOnce(() => Promise.resolve(contact));
    expect(await get("get_contact").handler({ contactId: "c1" }, admin)).toEqual(contact);
  });

  it("list_contacts can sort, e.g. top clients by paid total", async () => {
    const { contacts, get } = build();
    const schema = get("list_contacts").inputSchema;
    expect(schema.safeParse({ sort: "email" }).success).toBe(false);
    expect(schema.safeParse({ dir: "up" }).success).toBe(false);
    await runTool(get("list_contacts"), schema.parse({ sort: "paid", dir: "desc", limit: 5 }), admin);
    expect(contacts.findAll).toHaveBeenCalledWith("org1", { sort: "paid", dir: "desc", page: 1, limit: 5 });
  });

  it("list_contacts passes a portal access filter and rejects an unknown one", async () => {
    const { contacts, get } = build();
    const schema = get("list_contacts").inputSchema;
    expect(schema.safeParse({ access: "everyone" }).success).toBe(false);
    await runTool(get("list_contacts"), schema.parse({ access: "pending" }), admin);
    expect(contacts.findAll).toHaveBeenCalledWith("org1", { access: "pending", page: 1, limit: 20 });
  });

  it("list_contacts rejects an unknown status", () => {
    const schema = build().get("list_contacts").inputSchema;
    expect(schema.safeParse({ status: "customer" }).success).toBe(false);
  });

  it("get_contact is scoped to the org", async () => {
    const { contacts, get } = build();
    await runTool(get("get_contact"), { contactId: "c1" }, admin);
    expect(contacts.findOne).toHaveBeenCalledWith("c1", "org1");
  });

  it("add_contact_note authors the note as the acting user", async () => {
    const { contacts, get } = build();
    await runTool(get("add_contact_note"), { contactId: "c1", content: "Called" }, admin);
    expect(contacts.addNote).toHaveBeenCalledWith("c1", "Called", "org1", "u1");
  });

  it("add_contact_note rejects blank content and trims padded content", () => {
    const schema = build().get("add_contact_note").inputSchema;
    expect(schema.safeParse({ contactId: "c1", content: "  " }).success).toBe(false);
    const parsed = schema.safeParse({ contactId: "c1", content: "  Hi  " });
    expect((parsed.data as { content: string }).content).toBe("Hi");
  });
});
