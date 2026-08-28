import { test, expect, type Browser } from "@playwright/test";

const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";

/**
 * The auth proxy exposes Better Auth's `organization/create` to every
 * logged-in user. `AuthService.mayCreateOrganization` gates it by role:
 * owners/admins and brand-new signups may create an org; a portal client may
 * not. Clients are invited with `role: "member"` and therefore DO hold a
 * Member row — the earlier version of this gate treated any membership as
 * staff and let every client through, so this test pins the real shape.
 */

function uniq(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function signUpOwner(browser: Browser) {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  const email = `${uniq("gate-owner")}@test.local`;

  const res = await page.request.post(`${API_URL}/api/onboarding/signup`, {
    data: {
      name: "Gate Owner",
      email,
      password: "GateOwner123!",
      orgName: `Gate Org ${Date.now().toString(36)}`,
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return { context, page, email };
}

test.describe("Organization creation gate", () => {
  test("an owner can create another organization, a portal client cannot", async ({
    browser,
  }) => {
    const owner = await signUpOwner(browser);

    // Positive control: the owner is allowed through.
    const ownerCreate = await owner.page.request.post(
      `${API_URL}/api/auth/organization/create`,
      {
        data: { name: "Owner Second Org", slug: uniq("owner-second") },
        headers: { Origin: WEB_URL },
      },
    );
    expect(ownerCreate.status(), await ownerCreate.text()).toBe(200);

    // Invite a client into the owner's org (role "member", as the dashboard does).
    const clientEmail = `${uniq("gate-client")}@test.local`;
    const invite = await owner.page.request.post(
      `${API_URL}/api/auth/organization/invite-member`,
      {
        data: { email: clientEmail, role: "member" },
        headers: { Origin: WEB_URL },
      },
    );
    expect(invite.ok(), await invite.text()).toBe(true);
    const inviteBody = await invite.json();
    const invitationId =
      inviteBody?.id || inviteBody?.invitation?.id || inviteBody?.data?.id;
    expect(invitationId).toBeTruthy();
    await owner.context.close();

    // The client signs up and accepts, all in their own context.
    const client = await browser.newContext({ storageState: undefined });
    const clientPage = await client.newPage();

    const signup = await clientPage.request.post(
      `${API_URL}/api/auth/sign-up/email`,
      {
        data: { name: "Gate Client", email: clientEmail, password: "GateClient123!" },
        headers: { Origin: WEB_URL },
      },
    );
    expect(signup.ok(), await signup.text()).toBe(true);

    const accept = await clientPage.request.post(
      `${API_URL}/api/auth/organization/accept-invitation`,
      { data: { invitationId }, headers: { Origin: WEB_URL } },
    );
    expect(accept.ok(), await accept.text()).toBe(true);

    // The client now holds a Member row with role "member". They must be refused.
    const clientCreate = await clientPage.request.post(
      `${API_URL}/api/auth/organization/create`,
      {
        data: { name: "Client Rogue Org", slug: uniq("client-rogue") },
        headers: { Origin: WEB_URL },
      },
    );
    expect(clientCreate.status()).toBe(403);

    // And nothing was created behind the refusal.
    const list = await clientPage.request.get(
      `${API_URL}/api/auth/organization/list`,
    );
    const orgs: { name: string }[] = await list.json();
    expect(orgs.some((o) => o.name === "Client Rogue Org")).toBe(false);

    await client.close();
  });
});
