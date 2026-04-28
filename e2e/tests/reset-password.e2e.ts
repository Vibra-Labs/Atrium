import { test, expect } from "@playwright/test";

const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";

test.describe("Reset Password Page", () => {
  test("shows 'Invalid Reset Link' UI when no token is present", async ({
    page,
  }) => {
    await page.goto("/reset-password");
    await expect(
      page.getByRole("heading", { name: /invalid reset link/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /request a new reset link/i }),
    ).toBeVisible();
  });

  test("rejects a junk token with a server error message", async ({ page }) => {
    await page.goto("/reset-password?token=this-token-does-not-exist");
    await page.getByLabel(/^new password$/i).fill("BrandNewPass456!");
    await page.getByLabel(/confirm password/i).fill("BrandNewPass456!");
    await page.getByRole("button", { name: /reset password/i }).click();

    await expect(
      page.getByText(/invalid|expired|failed to reset/i),
    ).toBeVisible({ timeout: 10000 });
    // Still on the form, not the success state
    await expect(
      page.getByRole("heading", { name: /password reset$/i }),
    ).not.toBeVisible();
  });

  test("rejects mismatched passwords client-side without hitting the API", async ({
    page,
  }) => {
    const apiCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/auth/reset-password")) {
        apiCalls.push(req.url());
      }
    });

    await page.goto("/reset-password?token=anything");
    await page.getByLabel(/^new password$/i).fill("BrandNewPass456!");
    await page.getByLabel(/confirm password/i).fill("Different123!");
    await page.getByRole("button", { name: /reset password/i }).click();

    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
    expect(apiCalls).toHaveLength(0);
  });

  test("resets password successfully and old password no longer works", async ({
    browser,
  }) => {
    // Create owner A and owner B, then have A generate a reset link for B via
    // the admin reset endpoint (the only path that exposes the URL to tests).
    const adminCtx = await browser.newContext({ storageState: undefined });
    const adminPage = await adminCtx.newPage();
    const adminEmail = `reset-admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const adminPassword = "AdminPass123!";
    await adminPage.request.post(`${API_URL}/api/onboarding/signup`, {
      data: {
        name: "Reset Admin",
        email: adminEmail,
        password: adminPassword,
        orgName: `Reset Admin Org ${Date.now().toString(36)}`,
      },
    });
    await adminPage.goto(`${WEB_URL}/login`);
    await adminPage.getByLabel(/email/i).fill(adminEmail);
    await adminPage.getByLabel(/password/i).fill(adminPassword);
    await adminPage.getByRole("button", { name: /sign in/i }).click();
    await adminPage.waitForURL(/\/(setup|dashboard)/, { timeout: 15000 });
    if (adminPage.url().includes("/setup")) {
      const cookies = await adminCtx.cookies();
      const csrfToken = cookies.find((c) => c.name === "csrf-token")?.value || "";
      await adminPage.request.post(`${API_URL}/api/setup/complete`, {
        headers: { "x-csrf-token": csrfToken },
      });
    }

    // Invite a client and have them accept
    const clientEmail = `reset-client-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const originalPassword = "ClientOriginal123!";
    const inviteRes = await adminPage.request.post(
      `${API_URL}/api/auth/organization/invite-member`,
      {
        data: { email: clientEmail, role: "member" },
        headers: { Origin: WEB_URL },
      },
    );
    expect(inviteRes.ok()).toBe(true);
    const invitationBody = await inviteRes.json();
    const invitationId = invitationBody?.id || invitationBody?.invitation?.id;

    const clientCtx = await browser.newContext({ storageState: undefined });
    const clientPage = await clientCtx.newPage();
    await clientPage.goto(`${WEB_URL}/accept-invite?id=${invitationId}`);
    await clientPage.getByLabel(/your name/i).fill("Reset Client");
    await clientPage.getByLabel(/email/i).fill(clientEmail);
    await clientPage.getByLabel(/password/i).fill(originalPassword);
    await clientPage
      .getByRole("button", { name: /create account & join/i })
      .click();
    await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });
    await clientCtx.close();

    // Admin generates a reset link via the admin endpoint
    const membersRes = await adminPage.request.get(
      `${API_URL}/api/clients?limit=100`,
    );
    const { data: members } = await membersRes.json();
    const target = members.find(
      (m: { user?: { email: string } }) => m.user?.email === clientEmail,
    );
    expect(target).toBeDefined();

    const cookies = await adminCtx.cookies();
    const csrfToken =
      cookies.find((c) => c.name === "csrf-token")?.value || "";
    const resetRes = await adminPage.request.post(
      `${API_URL}/api/clients/${target.id}/reset-password`,
      { headers: { "x-csrf-token": csrfToken, Origin: WEB_URL } },
    );
    expect(resetRes.ok()).toBe(true);
    const { url: resetUrl } = await resetRes.json();
    expect(resetUrl).toMatch(/\/reset-password\//);
    await adminCtx.close();

    // Client follows the reset URL → set new password
    const newCtx = await browser.newContext({ storageState: undefined });
    const newPage = await newCtx.newPage();
    await newPage.goto(resetUrl);
    await newPage.waitForURL(/\/reset-password\?token=/, { timeout: 15000 });

    const newPassword = "BrandNewPass456!";
    await newPage.getByLabel(/^new password$/i).fill(newPassword);
    await newPage.getByLabel(/confirm password/i).fill(newPassword);
    await newPage.getByRole("button", { name: /reset password/i }).click();
    await expect(
      newPage.getByRole("heading", { name: /^password reset$/i }),
    ).toBeVisible({ timeout: 10000 });

    // Old password must no longer work
    await newPage.goto(`${WEB_URL}/login`);
    await newPage.getByLabel(/email/i).fill(clientEmail);
    await newPage.getByLabel(/password/i).fill(originalPassword);
    await newPage.getByRole("button", { name: /sign in/i }).click();
    await expect(newPage.getByText(/invalid|incorrect|wrong/i)).toBeVisible({
      timeout: 10000,
    });

    // New password works
    await newPage.getByLabel(/password/i).fill(newPassword);
    await newPage.getByRole("button", { name: /sign in/i }).click();
    await expect(newPage).toHaveURL(/\/portal/, { timeout: 20000 });

    await newCtx.close();
  });

  test("rejects a token after it has been used once", async ({ browser }) => {
    // Same setup as above, but reuse the token after a successful reset.
    const adminCtx = await browser.newContext({ storageState: undefined });
    const adminPage = await adminCtx.newPage();
    const adminEmail = `reset-reuse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const adminPassword = "AdminPass123!";
    await adminPage.request.post(`${API_URL}/api/onboarding/signup`, {
      data: {
        name: "Reset Reuse Admin",
        email: adminEmail,
        password: adminPassword,
        orgName: `Reset Reuse Org ${Date.now().toString(36)}`,
      },
    });
    await adminPage.goto(`${WEB_URL}/login`);
    await adminPage.getByLabel(/email/i).fill(adminEmail);
    await adminPage.getByLabel(/password/i).fill(adminPassword);
    await adminPage.getByRole("button", { name: /sign in/i }).click();
    await adminPage.waitForURL(/\/(setup|dashboard)/, { timeout: 15000 });
    if (adminPage.url().includes("/setup")) {
      const cookies = await adminCtx.cookies();
      const csrfToken = cookies.find((c) => c.name === "csrf-token")?.value || "";
      await adminPage.request.post(`${API_URL}/api/setup/complete`, {
        headers: { "x-csrf-token": csrfToken },
      });
    }

    const clientEmail = `reset-reuse-client-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const inviteRes = await adminPage.request.post(
      `${API_URL}/api/auth/organization/invite-member`,
      {
        data: { email: clientEmail, role: "member" },
        headers: { Origin: WEB_URL },
      },
    );
    const invitationBody = await inviteRes.json();
    const invitationId = invitationBody?.id || invitationBody?.invitation?.id;

    const clientCtx = await browser.newContext({ storageState: undefined });
    const clientPage = await clientCtx.newPage();
    await clientPage.goto(`${WEB_URL}/accept-invite?id=${invitationId}`);
    await clientPage.getByLabel(/your name/i).fill("Reset Reuse Client");
    await clientPage.getByLabel(/email/i).fill(clientEmail);
    await clientPage.getByLabel(/password/i).fill("ClientOriginal123!");
    await clientPage
      .getByRole("button", { name: /create account & join/i })
      .click();
    await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });
    await clientCtx.close();

    const membersRes = await adminPage.request.get(
      `${API_URL}/api/clients?limit=100`,
    );
    const { data: members } = await membersRes.json();
    const target = members.find(
      (m: { user?: { email: string } }) => m.user?.email === clientEmail,
    );
    const cookies = await adminCtx.cookies();
    const csrfToken =
      cookies.find((c) => c.name === "csrf-token")?.value || "";
    const resetRes = await adminPage.request.post(
      `${API_URL}/api/clients/${target.id}/reset-password`,
      { headers: { "x-csrf-token": csrfToken, Origin: WEB_URL } },
    );
    const { url: resetUrl } = await resetRes.json();
    await adminCtx.close();

    // First use: success
    const firstCtx = await browser.newContext({ storageState: undefined });
    const firstPage = await firstCtx.newPage();
    await firstPage.goto(resetUrl);
    await firstPage.waitForURL(/\/reset-password\?token=/, { timeout: 15000 });
    const tokenedUrl = firstPage.url();
    await firstPage.getByLabel(/^new password$/i).fill("FirstNewPass789!");
    await firstPage.getByLabel(/confirm password/i).fill("FirstNewPass789!");
    await firstPage.getByRole("button", { name: /reset password/i }).click();
    await expect(
      firstPage.getByRole("heading", { name: /^password reset$/i }),
    ).toBeVisible({ timeout: 10000 });
    await firstCtx.close();

    // Second use of the same token: must fail
    const secondCtx = await browser.newContext({ storageState: undefined });
    const secondPage = await secondCtx.newPage();
    await secondPage.goto(tokenedUrl);
    await secondPage.getByLabel(/^new password$/i).fill("SecondTry456!");
    await secondPage.getByLabel(/confirm password/i).fill("SecondTry456!");
    await secondPage.getByRole("button", { name: /reset password/i }).click();
    await expect(
      secondPage.getByText(/invalid|expired|failed to reset/i),
    ).toBeVisible({ timeout: 10000 });
    await secondCtx.close();
  });
});
