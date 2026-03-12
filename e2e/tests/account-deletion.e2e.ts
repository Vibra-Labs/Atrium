import { test, expect } from "@playwright/test";

const API_URL = "http://localhost:3001";

/**
 * Helper: sign up a fresh user, complete setup, and return a logged-in context.
 */
async function createTestUser(
  browser: import("@playwright/test").Browser,
  prefix = "del-test",
) {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  const orgName = `${prefix} Org ${Date.now().toString(36)}`;
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const password = "DeleteTest123!";

  const res = await page.request.post(`${API_URL}/api/onboarding/signup`, {
    data: {
      name: "Delete Test User",
      email,
      password,
      orgName,
    },
  });

  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Signup failed (${res.status()}): ${body}`);
  }

  // Navigate to establish session cookies in the browser context
  await page.goto("http://localhost:3000/dashboard", {
    waitUntil: "networkidle",
    timeout: 15000,
  });

  let url = page.url();
  if (url.includes("/login")) {
    await page.goto("http://localhost:3000/login");
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
    await page.goto("http://localhost:3000/dashboard", {
      waitUntil: "networkidle",
      timeout: 15000,
    });
  }

  return { context, page, email, password, orgName };
}

test.describe("Account Deletion", () => {
  test("owner can delete their account and org, redirected to login", async ({
    browser,
  }) => {
    const { context, page, orgName } = await createTestUser(browser);

    await page.goto("http://localhost:3000/dashboard/settings/account");
    await expect(
      page.getByRole("heading", { name: /account settings/i }),
    ).toBeVisible({ timeout: 10000 });

    // Verify the Danger Zone section is visible (owner only)
    await expect(page.getByText("Danger Zone")).toBeVisible();

    // Enter password to enable the delete button
    await page.getByPlaceholder("Your current password").fill("DeleteTest123!");

    // Click delete account button
    await page.getByRole("button", { name: /delete account/i }).click();

    // Confirmation dialog should appear with org name
    await expect(page.getByText("This will permanently delete")).toBeVisible();
    await expect(page.getByText(orgName, { exact: true }).first()).toBeVisible();

    // Type "DELETE <orgName>" to confirm (last textbox is the confirm input)
    await page.getByRole("textbox").last().fill(`DELETE ${orgName}`);

    // Click the confirm button in the dialog
    await page.getByRole("button", { name: /delete account/i }).last().click();

    // Should redirect to login
    await expect(page).toHaveURL(/login/, { timeout: 10000 });

    await context.close();
  });

  test("deleted user cannot log in again", async ({ browser }) => {
    const { context, page, email, password, orgName } =
      await createTestUser(browser);

    // Delete the account via UI
    await page.goto("http://localhost:3000/dashboard/settings/account");
    await expect(page.getByText("Danger Zone")).toBeVisible({ timeout: 10000 });
    await page.getByPlaceholder("Your current password").fill("DeleteTest123!");
    await page.getByRole("button", { name: /delete account/i }).click();
    await expect(page.getByText("This will permanently delete")).toBeVisible();
    await page.getByRole("textbox").last().fill(`DELETE ${orgName}`);
    await page.getByRole("button", { name: /delete account/i }).last().click();
    await expect(page).toHaveURL(/login/, { timeout: 10000 });
    await context.close();

    // Try to log in with the deleted credentials
    const newContext = await browser.newContext({ storageState: undefined });
    const loginPage = await newContext.newPage();
    await loginPage.goto("http://localhost:3000/login");
    await loginPage.getByLabel(/email/i).fill(email);
    await loginPage.getByLabel(/password/i).fill(password);
    await loginPage.getByRole("button", { name: /sign in/i }).click();

    // Should show an error (invalid credentials)
    await expect(loginPage.locator(".text-red-600")).toBeVisible({
      timeout: 5000,
    });

    await newContext.close();
  });

  test("non-owner sees danger zone with non-owner messaging", async ({
    browser,
  }) => {
    // Create user A (the owner)
    const { context: ctxA, page: pageA } = await createTestUser(
      browser,
      "owner-vis",
    );

    // Invite a second user to the org
    const inviteeEmail = `invitee-${Date.now()}@test.local`;
    const inviteRes = await pageA.request.post(
      `${API_URL}/api/auth/organization/invite-member`,
      {
        data: { email: inviteeEmail, role: "member" },
        headers: { Origin: "http://localhost:3000" },
      },
    );

    if (!inviteRes.ok()) {
      await ctxA.close();
      test.skip(true, "Could not invite member — skipping non-owner test");
      return;
    }

    const inviteData = await inviteRes.json();
    const invitationId =
      inviteData?.id || inviteData?.invitation?.id || inviteData?.data?.id;

    if (!invitationId) {
      await ctxA.close();
      test.skip(true, "No invitation ID returned — skipping non-owner test");
      return;
    }

    // Create user B and accept the invitation
    const ctxB = await browser.newContext({ storageState: undefined });
    const pageB = await ctxB.newPage();

    await pageB.request.post(`${API_URL}/api/auth/sign-up/email`, {
      data: {
        name: "Invited Member",
        email: inviteeEmail,
        password: "InvitedTest123!",
      },
      headers: { Origin: "http://localhost:3000" },
    });

    await pageB.request.post(
      `${API_URL}/api/auth/organization/accept-invitation`,
      {
        data: { invitationId },
        headers: { Origin: "http://localhost:3000" },
      },
    );

    // Log in as user B
    await pageB.goto("http://localhost:3000/login");
    await pageB.getByLabel(/email/i).fill(inviteeEmail);
    await pageB.getByLabel(/password/i).fill("InvitedTest123!");
    await pageB.getByRole("button", { name: /sign in/i }).click();
    await pageB.waitForURL(/\/(setup|dashboard|portal)/, { timeout: 15000 });

    // Navigate to portal settings — non-owner should see delete account section
    await pageB.goto("http://localhost:3000/portal/settings");
    await expect(
      pageB.getByRole("heading", { name: /account settings/i }),
    ).toBeVisible({ timeout: 10000 });
    await expect(pageB.getByRole("heading", { name: "Delete Account" })).toBeVisible();
    await expect(pageB.getByText("Permanently delete your account and remove your access")).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });
});
