import { describe, expect, it } from "bun:test";
import { demoSeedPlan } from "@atrium/database";

const SLUG = "demo";
const OWNER = "owner@demo.invalid";
const CLIENT = "client@demo.invalid";

describe("demoSeedPlan", () => {
  const plan = demoSeedPlan(SLUG, OWNER, CLIENT);

  it("puts the organization on the configured slug", () => {
    expect(plan.organization.slug).toBe(SLUG);
    expect(plan.organization.name.length).toBeGreaterThan(0);
  });

  it("pins the workspace to the pro plan, never a trial", () => {
    // On free, @PlanLimit refuses a fourth project and planHasFeature 403s the
    // seeded contract and invoices; a trial would expire and cripple the demo.
    expect(plan.planSlug).toBe("pro");
  });

  it("uses only @demo.invalid addresses", () => {
    expect(plan.users.length).toBeGreaterThan(1);
    for (const user of plan.users) {
      expect(user.email.endsWith("@demo.invalid")).toBe(true);
    }
    for (const contact of plan.contacts) {
      if (contact.email) expect(contact.email.endsWith("@demo.invalid")).toBe(true);
    }
  });

  it("names the configured owner and client addresses", () => {
    expect(plan.users.find((u) => u.role === "owner")?.email).toBe(OWNER);
    expect(plan.users.find((u) => u.role === "member")?.email).toBe(CLIENT);
  });

  it("seeds three projects across different statuses", () => {
    expect(plan.projects).toHaveLength(3);
    expect(new Set(plan.projects.map((p) => p.status)).size).toBeGreaterThan(1);
  });

  it("gives the portal client at least one project, so the client entry is not empty", () => {
    const clientKey = plan.users.find((u) => u.role === "member")?.key;
    expect(plan.projects.some((p) => p.clientKeys.includes(clientKey!))).toBe(true);
  });

  it("has exactly one paid invoice and one still due", () => {
    expect(plan.invoices.filter((i) => i.status === "paid")).toHaveLength(1);
    expect(plan.invoices.filter((i) => i.status === "sent")).toHaveLength(1);
  });

  it("seeds a signed document and one awaiting signature", () => {
    expect(plan.documents.some((d) => d.status === "signed")).toBe(true);
    expect(plan.documents.some((d) => d.status === "pending")).toBe(true);
  });

  it("seeds tasks, contacts, updates and time entries", () => {
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.contacts.length).toBeGreaterThan(0);
    expect(plan.updates.length).toBeGreaterThan(0);
    expect(plan.timeEntries.length).toBeGreaterThan(0);
  });

  it("references only projects and users it defines", () => {
    const projectKeys = new Set(plan.projects.map((p) => p.key));
    const userKeys = new Set(plan.users.map((u) => u.key));
    for (const task of plan.tasks) {
      expect(projectKeys.has(task.projectKey)).toBe(true);
      if (task.assigneeKey) expect(userKeys.has(task.assigneeKey)).toBe(true);
    }
    for (const update of plan.updates) expect(projectKeys.has(update.projectKey)).toBe(true);
    for (const invoice of plan.invoices) expect(projectKeys.has(invoice.projectKey)).toBe(true);
    for (const doc of plan.documents) expect(projectKeys.has(doc.projectKey)).toBe(true);
    for (const entry of plan.timeEntries) {
      expect(projectKeys.has(entry.projectKey)).toBe(true);
      expect(userKeys.has(entry.userKey)).toBe(true);
    }
  });

  it("is deterministic, so a reset restores the same workspace", () => {
    expect(demoSeedPlan(SLUG, OWNER, CLIENT)).toEqual(plan);
  });

  it("refuses an address outside the demo domain", () => {
    expect(() => demoSeedPlan(SLUG, "edgar@vibralabs.co", CLIENT)).toThrow();
  });

  it("links the portal client's contact to whatever address is configured", () => {
    // The contact used to hardcode client@demo.invalid, so a configured
    // DEMO_CLIENT_EMAIL left the one client with a portal login showing
    // access=none -- the feature the seed exists to demonstrate.
    const configured = demoSeedPlan(SLUG, OWNER, "demo-client@demo.invalid");
    const clientUser = configured.users.find((u) => u.role === "member");

    expect(configured.contacts.some((c) => c.email === clientUser!.email)).toBe(true);
  });

  it("seeds one owner and staff who are not owners, so roles are distinguishable", () => {
    // Two owners also weakens the reset's owner-domain assertion, which has to
    // hold for every owner row.
    expect(plan.users.filter((u) => u.role === "owner")).toHaveLength(1);
    expect(plan.users.filter((u) => u.role === "admin").length).toBeGreaterThan(0);
  });
});
