import { test, expect } from "@playwright/test";

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

test.describe("Accept Invite", () => {
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

    // Step 5: Switch to login mode
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
      page.getByRole("heading", { name: /invalid invitation/i }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText(/this invitation link is missing or invalid/i),
    ).toBeVisible();

    await context.close();
  });
});
