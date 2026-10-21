import { test, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { createOwner, inviteAndAcceptClient, signIn } from "./helpers";

const API = "http://localhost:3001/api";

// Portal clients are Better Auth members, so Better Auth would hand them every
// other member's name and email. The proxy keeps those routes to staff.
test.describe("Organization privacy", () => {
  let ownerContext: BrowserContext;
  let owner: Page;
  let ownerEmail: string;
  let clientContext: BrowserContext;
  let client: Page;
  let orgName: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120000);
    const created = await createOwner(browser, "org-privacy");
    ownerContext = created.context;
    owner = created.page;
    ownerEmail = created.email;
    const { clientEmail, password } = await inviteAndAcceptClient(browser, owner, "org-privacy-client");
    ({ context: clientContext, page: client } = await signIn(browser, clientEmail, password));

    const res = await owner.request.get(`${API}/organization/current`);
    expect(res.status()).toBe(200);
    const org: { name: string; role: string } = await res.json();
    expect(org.role).toBe("owner");
    orgName = org.name;
  });

  test.afterAll(async () => {
    await clientContext?.close();
    await ownerContext?.close();
  });

  test("a portal client is refused the member and invitation lists", async () => {
    for (const path of [
      "get-full-organization",
      "list-members",
      "list-invitations",
      "get-active-member-role",
    ]) {
      const res = await client.request.get(`${API}/auth/organization/${path}`);
      expect(res.status(), path).toBe(403);
      const body: string = await res.text();
      expect(body, path).not.toContain(ownerEmail);
    }
  });

  test("a portal client still gets its own workspace and membership", async () => {
    const current = await client.request.get(`${API}/organization/current`);
    expect(current.status()).toBe(200);
    const org: { id: string; name: string; role: string; members?: unknown } = await current.json();
    expect(org.name).toBe(orgName);
    expect(org.role).toBe("member");
    expect(org.members).toBeUndefined();

    expect((await client.request.get(`${API}/auth/organization/list`)).status()).toBe(200);
    expect((await client.request.get(`${API}/auth/organization/get-active-member`)).status()).toBe(200);
  });

  test("the owner can still read the full organization and member list", async () => {
    const full = await owner.request.get(`${API}/auth/organization/get-full-organization`);
    expect(full.status()).toBe(200);
    expect(await full.text()).toContain(ownerEmail);

    const members = await owner.request.get(`${API}/auth/organization/list-members`);
    expect(members.status()).toBe(200);
  });

  test("the portal header still shows the workspace name", async () => {
    await client.goto("http://localhost:3000/portal/projects");
    await expect(client.locator("header").getByText(orgName, { exact: true })).toBeVisible({ timeout: 15000 });
  });

  test("the dashboard shows the workspace name and Settings → Team lists the owner", async () => {
    await owner.goto("http://localhost:3000/dashboard/settings/team");
    await expect(owner.getByText(orgName, { exact: true }).first()).toBeVisible({ timeout: 15000 });
    await expect(owner.getByText("(you)")).toBeVisible();
    await expect(owner.getByText(ownerEmail).first()).toBeVisible();
  });
});
