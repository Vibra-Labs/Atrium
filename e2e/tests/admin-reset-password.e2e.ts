import { test, expect } from "@playwright/test";

const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";

async function createOwnerUser(
  browser: import("@playwright/test").Browser,
  prefix = "reset-owner",
) {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  const orgName = `${prefix} Org ${Date.now().toString(36)}`;
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const password = "ResetOwner123!";

  const res = await page.request.post(`${API_URL}/api/onboarding/signup`, {
    data: { name: "Reset Owner", email, password, orgName },
  });
  if (!res.ok()) {
    throw new Error(`Owner signup failed (${res.status()}): ${await res.text()}`);
  }

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

async function createAndAcceptClient(
  browser: import("@playwright/test").Browser,
  ownerPage: import("@playwright/test").Page,
  prefix: string,
) {
  const clientEmail = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const originalPassword = "ClientOriginal123!";

  // Owner invites
  const inviteRes = await ownerPage.request.post(
    `${API_URL}/api/auth/organization/invite-member`,
    {
      data: { email: clientEmail, role: "member" },
      headers: { Origin: WEB_URL },
    },
  );
  if (!inviteRes.ok()) {
    throw new Error(`Invite failed (${inviteRes.status()}): ${await inviteRes.text()}`);
  }
  const invitationId =
    (await inviteRes.json())?.id ||
    (await inviteRes.json())?.invitation?.id;

  // Client accepts in a fresh context
  const clientCtx = await browser.newContext({ storageState: undefined });
  const clientPage = await clientCtx.newPage();
  await clientPage.goto(`${WEB_URL}/accept-invite?id=${invitationId}`, {
    waitUntil: "networkidle",
    timeout: 15000,
  });
  await clientPage.getByLabel(/your name/i).fill("Locked Out Client");
  await clientPage.getByLabel(/email/i).fill(clientEmail);
  await clientPage.getByLabel(/password/i).fill(originalPassword);
  await clientPage.getByRole("button", { name: /create account & join/i }).click();
  await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });
  await clientCtx.close();

  return { clientEmail, originalPassword };
}

test.describe("Admin Reset Password", () => {
  test("owner generates a reset link for a client and the client uses it to set a new password", async ({
    browser,
  }) => {
    const { context: ownerCtx, page: ownerPage } = await createOwnerUser(
      browser,
      "admin-reset",
    );
    const { clientEmail } = await createAndAcceptClient(
      browser,
      ownerPage,
      "admin-reset-client",
    );

    // Owner navigates to the people page and switches to Clients tab
    await ownerPage.goto(`${WEB_URL}/dashboard/clients`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });
    await ownerPage.getByRole("button", { name: /^clients/i }).click();

    // Find the client row and click the reset-password action
    const clientRow = ownerPage
      .locator("div")
      .filter({ hasText: clientEmail })
      .first();
    await expect(clientRow).toBeVisible({ timeout: 10000 });
    await clientRow.getByTitle("Send password reset link").click();

    // Confirm modal appears
    await ownerPage.getByRole("button", { name: /generate link/i }).click();

    // Modal with reset URL appears
    await expect(
      ownerPage.getByRole("heading", { name: /password reset link/i }),
    ).toBeVisible({ timeout: 10000 });

    // Pull the URL out of the readonly input
    const resetUrl = await ownerPage
      .locator('input[readonly][value*="/reset-password/"]')
      .first()
      .inputValue();
    expect(resetUrl).toMatch(/\/reset-password\//);

    await ownerCtx.close();

    // Client uses the link in a fresh context
    const clientCtx = await browser.newContext({ storageState: undefined });
    const clientPage = await clientCtx.newPage();
    await clientPage.goto(resetUrl, { waitUntil: "networkidle", timeout: 15000 });

    // Better Auth's GET /api/auth/reset-password/:token redirects to
    // /reset-password?token=... — wait for that landing page.
    await clientPage.waitForURL(/\/reset-password\?token=/, { timeout: 15000 });

    const newPassword = "BrandNewPass456!";
    await clientPage.getByLabel(/^new password$/i).fill(newPassword);
    await clientPage.getByLabel(/confirm password/i).fill(newPassword);
    await clientPage.getByRole("button", { name: /reset password/i }).click();

    // Success state
    await expect(
      clientPage.getByRole("heading", { name: /password reset/i }),
    ).toBeVisible({ timeout: 10000 });

    // Client can now log in with the new password
    await clientPage.goto(`${WEB_URL}/login`);
    await clientPage.getByLabel(/email/i).fill(clientEmail);
    await clientPage.getByLabel(/password/i).fill(newPassword);
    await clientPage.getByRole("button", { name: /sign in/i }).click();
    await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });

    await clientCtx.close();
  });
});
