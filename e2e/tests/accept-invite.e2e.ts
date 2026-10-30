import { test, expect } from "@playwright/test";
import { latestMagicLinkToken } from "./helpers";

const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";

/**
 * Helper: create an owner user with an org via the onboarding API,
 * then establish a browser session for that user.
 */
async function createOwnerUser(
  browser: import("@playwright/test").Browser,
  prefix = "invite-owner",
) {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  const orgName = `${prefix} Org ${Date.now().toString(36)}`;
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const password = "InviteOwner123!";

  const res = await page.request.post(`${API_URL}/api/onboarding/signup`, {
    data: {
      name: "Invite Owner",
      email,
      password,
      orgName,
    },
  });

  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Owner signup failed (${res.status()}): ${body}`);
  }

  // Navigate to establish session cookies
  await page.goto(`${WEB_URL}/dashboard`, {
    waitUntil: "networkidle",
    timeout: 15000,
  });

  let url = page.url();
  if (url.includes("/login")) {
    await page.goto(`${WEB_URL}/login`);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(setup|dashboard)/, { timeout: 15000 });
    url = page.url();
  }

  if (url.includes("/setup")) {
    await page.request.get(`${API_URL}/api/setup/status`);
    const cookies = await context.cookies();
    const csrfToken = cookies.find((c) => c.name === "csrf-token")?.value || "";
    await page.request.post(`${API_URL}/api/setup/complete`, {
      headers: { "x-csrf-token": csrfToken },
    });
    await page.goto(`${WEB_URL}/dashboard`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });
  }

  return { context, page, email, password, orgName };
}

/**
 * Helper: invite a client email from an owner's page context.
 * Returns the invitation ID.
 */
async function inviteClient(
  ownerPage: import("@playwright/test").Page,
  clientEmail: string,
) {
  const inviteRes = await ownerPage.request.post(
    `${API_URL}/api/auth/organization/invite-member`,
    {
      data: { email: clientEmail, role: "member" },
      headers: { Origin: WEB_URL },
    },
  );

  if (!inviteRes.ok()) {
    const body = await inviteRes.text();
    throw new Error(`Invite failed (${inviteRes.status()}): ${body}`);
  }

  const inviteData = await inviteRes.json();
  const invitationId =
    inviteData?.id || inviteData?.invitation?.id || inviteData?.data?.id;

  if (!invitationId) {
    throw new Error(
      `No invitation ID returned: ${JSON.stringify(inviteData)}`,
    );
  }

  return invitationId;
}

/** A client who joined with "Open my portal" and so has no password, signed in on their own page. */
async function joinByLink(browser: import("@playwright/test").Browser, prefix: string) {
  const { context: ownerCtx, page: ownerPage } = await createOwnerUser(browser, `${prefix}-owner`);
  const clientEmail = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const invitationId = await inviteClient(ownerPage, clientEmail);
  await ownerCtx.close();

  const clientCtx = await browser.newContext({ storageState: undefined });
  const clientPage = await clientCtx.newPage();
  await clientPage.goto(`${WEB_URL}/accept-invite?id=${invitationId}`);
  await clientPage.getByRole("button", { name: /open my portal/i }).click();
  await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });
  return { clientCtx, clientPage, clientEmail };
}

test.describe("A client who joined by link", () => {
  // Each test creates an owner, invites, joins, then works in settings.
  test.setTimeout(60000);
  test("can set a first password without being asked for a current one", async ({ browser }) => {
    const { clientCtx, clientPage, clientEmail } = await joinByLink(browser, "nopw-set");

    await clientPage.goto(`${WEB_URL}/portal/settings`);
    await expect(clientPage.getByRole("heading", { name: "Set a Password" })).toBeVisible({ timeout: 15000 });
    await expect(clientPage.getByLabel("Current Password")).toHaveCount(0);

    await clientPage.getByLabel("New Password", { exact: true }).fill("FirstPassword123!");
    await clientPage.getByLabel("Confirm New Password").fill("FirstPassword123!");
    await clientPage.getByRole("button", { name: "Set Password" }).click();
    await expect(clientPage.getByText("Password set")).toBeVisible({ timeout: 10000 });
    await expect(clientPage.getByRole("heading", { name: "Change Password" })).toBeVisible();
    await clientCtx.close();

    // The new password works on the login page.
    const fresh = await browser.newContext({ storageState: undefined });
    const page = await fresh.newPage();
    await page.goto(`${WEB_URL}/login`);
    await page.getByLabel(/email/i).fill(clientEmail);
    await page.getByLabel(/password/i).fill("FirstPassword123!");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/portal/, { timeout: 20000 });
    await fresh.close();
  });

  test("can delete their account by typing their email address", async ({ browser }) => {
    const { clientCtx, clientPage, clientEmail } = await joinByLink(browser, "nopw-delete");
    clientPage.on("dialog", (dialog) => dialog.accept());

    await clientPage.goto(`${WEB_URL}/portal/settings`);
    const confirmation = clientPage.getByLabel("Type your email address to confirm");
    await expect(confirmation).toBeVisible({ timeout: 15000 });

    await confirmation.fill("someone-else@test.local");
    await clientPage.getByRole("button", { name: "Delete Account" }).click();
    await expect(clientPage.getByText("That email doesn't match your account.")).toBeVisible({ timeout: 10000 });

    await confirmation.fill(clientEmail);
    await clientPage.getByRole("button", { name: "Delete Account" }).click();
    await expect(clientPage).toHaveURL(/\/login/, { timeout: 20000 });
    await clientCtx.close();
  });
});

test.describe("Accept Invite", () => {
  test("client opens the portal from an invite with one click, no password", async ({
    browser,
  }) => {
    const { context: ownerCtx, page: ownerPage, orgName } = await createOwnerUser(browser, "inv-oneclick");
    const clientEmail = `inv-oneclick-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const invitationId = await inviteClient(ownerPage, clientEmail);
    await ownerCtx.close();

    const clientCtx = await browser.newContext({ storageState: undefined });
    const clientPage = await clientCtx.newPage();
    await clientPage.goto(`${WEB_URL}/accept-invite?id=${invitationId}`);

    await expect(
      clientPage.getByRole("heading", { name: `You're invited to ${orgName}` }),
    ).toBeVisible({ timeout: 15000 });
    await expect(clientPage.getByText(clientEmail)).toBeVisible();
    await expect(clientPage.getByLabel(/password/i)).toHaveCount(0);

    await clientPage.getByRole("button", { name: /open my portal/i }).click();
    await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });

    // The invite is spent: opening it again says so rather than offering to join.
    await clientPage.goto(`${WEB_URL}/accept-invite?id=${invitationId}`);
    await expect(
      clientPage.getByRole("heading", { name: /invitation unavailable/i }),
    ).toBeVisible({ timeout: 15000 });

    await clientCtx.close();
  });

  test("invitee who already has an account is emailed a sign-in link that joins them", async ({
    browser,
  }) => {
    const { context: ownerCtx, page: ownerPage, orgName } = await createOwnerUser(browser, "inv-emailed");
    const clientEmail = `inv-emailed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const invitationId = await inviteClient(ownerPage, clientEmail);
    await ownerCtx.close();

    const tempCtx = await browser.newContext({ storageState: undefined });
    const signupRes = await tempCtx.request.post(`${API_URL}/api/auth/sign-up/email`, {
      data: { name: "Existing Client", email: clientEmail, password: "ExistingClient123!" },
      headers: { Origin: WEB_URL },
    });
    expect(signupRes.ok()).toBe(true);
    await tempCtx.close();

    const clientCtx = await browser.newContext({ storageState: undefined });
    const clientPage = await clientCtx.newPage();
    await clientPage.goto(`${WEB_URL}/accept-invite?id=${invitationId}`);
    await clientPage.getByRole("button", { name: /open my portal/i }).click();
    await expect(clientPage.getByRole("heading", { name: /check your email/i })).toBeVisible({
      timeout: 15000,
    });
    await expect(clientPage.getByText(orgName)).toBeVisible();

    // Follow the emailed link: the confirm page, then back to the invite, which joins.
    const token: string = await latestMagicLinkToken(clientEmail);
    const callbackURL: string = `${WEB_URL}/accept-invite?id=${invitationId}`;
    await clientPage.goto(
      `${WEB_URL}/magic-link?token=${token}&callbackURL=${encodeURIComponent(callbackURL)}`,
    );
    await clientPage.getByRole("button", { name: /continue/i }).click();
    await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });

    await clientCtx.close();
  });

  test("client can sign up from invite link and gets redirected to portal", async ({
    browser,
  }) => {
    // Step 1: Create an owner user with an org
    const {
      context: ownerCtx,
      page: ownerPage,
    } = await createOwnerUser(browser, "inv-signup");

    // Step 2: Invite a client email
    const clientEmail = `inv-client-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const invitationId = await inviteClient(ownerPage, clientEmail);
    await ownerCtx.close();

    // Step 3: Open accept-invite page in a fresh browser context (no session)
    const clientCtx = await browser.newContext({ storageState: undefined });
    const clientPage = await clientCtx.newPage();

    await clientPage.goto(
      `${WEB_URL}/accept-invite?id=${invitationId}`,
      { waitUntil: "networkidle", timeout: 15000 },
    );

    await clientPage.getByRole("button", { name: /use a password instead/i }).click();

    // Verify the signup form is shown
    await expect(
      clientPage.getByRole("heading", { name: /join project portal/i }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      clientPage.getByText(/create an account to access your project/i),
    ).toBeVisible();

    // Step 4: Fill in the signup form
    await clientPage.getByLabel(/your name/i).fill("Invited Client");
    await clientPage.getByLabel(/email/i).fill(clientEmail);
    await clientPage.getByLabel(/password/i).fill("ClientPass123!");

    // Step 5: Submit the form
    await clientPage.getByRole("button", { name: /create account & join/i }).click();

    // Step 6: Verify redirect to portal
    await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });

    await clientCtx.close();
  });

  test("client with existing account can sign in from invite link", async ({
    browser,
  }) => {
    // Step 1: Create an owner user with an org
    const {
      context: ownerCtx,
      page: ownerPage,
    } = await createOwnerUser(browser, "inv-login");

    // Step 2: Invite the client email first (while owner session is active)
    const clientEmail = `inv-existing-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const clientPassword = "ExistingClient123!";

    const invitationId = await inviteClient(ownerPage, clientEmail);
    await ownerCtx.close();

    // Step 3: Create the client account in a separate context (so we don't clobber the owner session)
    const tempCtx = await browser.newContext({ storageState: undefined });
    const tempPage = await tempCtx.newPage();
    const signupRes = await tempPage.request.post(
      `${API_URL}/api/auth/sign-up/email`,
      {
        data: {
          name: "Existing Client",
          email: clientEmail,
          password: clientPassword,
        },
        headers: { Origin: WEB_URL },
      },
    );

    if (!signupRes.ok()) {
      const body = await signupRes.text();
      throw new Error(
        `Client account creation failed (${signupRes.status()}): ${body}`,
      );
    }
    await tempCtx.close();

    // Step 4: Open accept-invite page in a fresh browser context
    const clientCtx = await browser.newContext({ storageState: undefined });
    const clientPage = await clientCtx.newPage();

    await clientPage.goto(
      `${WEB_URL}/accept-invite?id=${invitationId}`,
      { waitUntil: "networkidle", timeout: 15000 },
    );

    // Step 5: Switch to the password form, then to login mode
    await clientPage.getByRole("button", { name: /use a password instead/i }).click();
    await clientPage.getByRole("button", { name: /sign in instead/i }).click();

    await expect(
      clientPage.getByText(/sign in to accept your invitation/i),
    ).toBeVisible();

    // Step 6: Fill in login credentials and submit
    await clientPage.getByLabel(/email/i).fill(clientEmail);
    await clientPage.getByLabel(/password/i).fill(clientPassword);
    await clientPage.getByRole("button", { name: /sign in & join/i }).click();

    // Step 7: Verify redirect to portal
    await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });

    await clientCtx.close();
  });

  test("client invited while already owning another org lands on portal, not setup", async ({
    browser,
  }) => {
    // The bug: setActiveOrgAndRedirect picked orgs[0] regardless of which org
    // was just joined, so a user who already owned an org would be sent to
    // /dashboard (and onward to /setup if that org had pending setup) instead
    // of /portal for the org they were invited to as a client.

    // Step 1: Inviter org and inviter session
    const {
      context: inviterCtx,
      page: inviterPage,
    } = await createOwnerUser(browser, "inv-multi-inviter");

    // Step 2: Invitee already owns their own (separate) org
    const inviteeEmail = `inv-multi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const inviteePassword = "MultiOrgClient123!";
    const ownCtx = await browser.newContext({ storageState: undefined });
    const ownPage = await ownCtx.newPage();
    const ownSignup = await ownPage.request.post(
      `${API_URL}/api/onboarding/signup`,
      {
        data: {
          name: "Multi Org Invitee",
          email: inviteeEmail,
          password: inviteePassword,
          orgName: `Invitee Own Org ${Date.now().toString(36)}`,
        },
      },
    );
    if (!ownSignup.ok()) {
      throw new Error(
        `Invitee own-org signup failed (${ownSignup.status()}): ${await ownSignup.text()}`,
      );
    }
    await ownCtx.close();

    // Step 3: Inviter invites the invitee as a client (member role)
    const invitationId = await inviteClient(inviterPage, inviteeEmail);
    await inviterCtx.close();

    // Step 4: Invitee opens the invite link in a fresh context and signs in
    const clientCtx = await browser.newContext({ storageState: undefined });
    const clientPage = await clientCtx.newPage();
    await clientPage.goto(
      `${WEB_URL}/accept-invite?id=${invitationId}`,
      { waitUntil: "networkidle", timeout: 15000 },
    );

    await clientPage.getByRole("button", { name: /use a password instead/i }).click();
    await clientPage.getByRole("button", { name: /sign in instead/i }).click();
    await clientPage.getByLabel(/email/i).fill(inviteeEmail);
    await clientPage.getByLabel(/password/i).fill(inviteePassword);
    await clientPage.getByRole("button", { name: /sign in & join/i }).click();

    // Step 5: Must land in the portal of the inviting org, NOT on their own
    // dashboard or setup wizard.
    await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });
    expect(clientPage.url()).not.toMatch(/\/dashboard/);
    expect(clientPage.url()).not.toMatch(/\/setup/);

    await clientCtx.close();
  });

  test("shows invalid invitation message when no ID is provided", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto(`${WEB_URL}/accept-invite`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });

    await expect(
      page.getByRole("heading", { name: /invitation unavailable/i }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/expired or was already used/i)).toBeVisible();

    await context.close();
  });
});
