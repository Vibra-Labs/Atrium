import { test, expect } from "@playwright/test";

const API_URL = "http://localhost:3001";

test.describe("Forgot Password", () => {
  test("renders the form with email field and submit button", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(
      page.getByRole("heading", { name: /forgot your password/i }),
    ).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /send reset link/i }),
    ).toBeVisible();
  });

  test("links back to sign in", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByRole("link", { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("submits to /api/auth/request-password-reset and shows success state", async ({
    browser,
  }) => {
    // Create a real user so the reset request hits a populated DB row.
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    const email = `forgot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const password = "ForgotPass123!";
    const signupRes = await page.request.post(`${API_URL}/api/onboarding/signup`, {
      data: {
        name: "Forgot Tester",
        email,
        password,
        orgName: `Forgot Org ${Date.now().toString(36)}`,
      },
    });
    expect(signupRes.ok()).toBe(true);

    const requests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/api/auth/")) requests.push(`${req.method()} ${url}`);
    });

    const requestPromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/auth/request-password-reset") &&
        res.request().method() === "POST",
      { timeout: 10000 },
    );

    await page.goto("/forgot-password");
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole("button", { name: /send reset link/i }).click();

    const response = await requestPromise;
    expect(response.status()).toBe(200);

    // Regression guard: the obsolete Better Auth 1.3 endpoint must NOT be hit.
    expect(
      requests.some((r) => r.includes("/api/auth/forget-password")),
    ).toBe(false);

    await expect(
      page.getByRole("heading", { name: /check your email/i }),
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(email)).toBeVisible();

    await context.close();
  });

  test("shows the same success state for an unknown email (no user enumeration)", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto("/forgot-password");
    await page
      .getByLabel(/email/i)
      .fill(`nobody-${Date.now()}@test.local`);
    await page.getByRole("button", { name: /send reset link/i }).click();

    await expect(
      page.getByRole("heading", { name: /check your email/i }),
    ).toBeVisible({ timeout: 5000 });

    await context.close();
  });
});
