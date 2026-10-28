import { test, expect } from "@playwright/test";

test.describe("Auth", () => {
  test("shows login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test("shows signup page", async ({ page }) => {
    await page.goto("/signup");

    // If billing is enabled, the plan selection step shows first
    const planHeading = page.getByRole("heading", { name: /choose your plan/i });
    const accountHeading = page.getByRole("heading", { name: /create your account/i });

    const hasPlanStep = await planHeading.isVisible().catch(() => false);
    if (hasPlanStep) {
      await expect(planHeading).toBeVisible();
      // Continue past plan selection
      await page.getByRole("button", { name: /continue/i }).click();
    }

    await expect(accountHeading).toBeVisible();
    await expect(page.getByLabel(/your name/i)).toBeVisible();
    await expect(page.getByLabel(/agency/i)).toBeVisible();
  });

  test("login page links to signup", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: /sign up/i }).click();
    await expect(page).toHaveURL(/signup/);
  });

  test("signup page links to login", async ({ page }) => {
    await page.goto("/signup");

    // If billing is enabled, plan step shows first — it also has a login link
    await page.getByRole("link", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/login/);
  });

  test("login shows error with invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("bad@example.com");
    await page.getByLabel(/password/i).fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.locator(".text-red-600")).toBeVisible({ timeout: 5000 });
  });

  test("signup and login end-to-end", async ({ browser }) => {
    // Use a fresh context with no saved auth state
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    const email = `login-test-${Date.now()}@test.local`;
    const password = "LoginTest123!";

    // Sign up a new account
    await page.goto("/signup");

    // Handle plan selection step if visible (billing enabled)
    const planHeading = page.getByRole("heading", { name: /choose your plan/i });
    const hasPlanStep = await planHeading.isVisible().catch(() => false);
    if (hasPlanStep) {
      // Select the free plan (default) and continue
      await page.getByRole("button", { name: /continue/i }).click();
    }

    await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();
    await page.getByLabel(/your name/i).fill("Login Test");
    await page.getByLabel(/agency/i).fill("Login Test Org");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /create account/i }).click();

    // Should redirect to setup wizard after signup (new accounts)
    await expect(page).toHaveURL(/setup/, { timeout: 10000 });
    await expect(page.getByRole("heading", { name: /welcome to atrium/i })).toBeVisible();

    // Complete setup to get to dashboard
    const apiUrl = "http://localhost:3001";
    // Ensure CSRF cookie is set by making a GET request first
    await page.request.get(`${apiUrl}/api/setup/status`);
    const cookies = await context.cookies();
    const csrfToken = cookies.find((c) => c.name === "csrf-token")?.value || "";
    await page.request.post(`${apiUrl}/api/setup/complete`, {
      headers: { "x-csrf-token": csrfToken },
    });
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });
    await expect(page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeVisible();

    // Log out by clearing cookies and verify redirect
    await context.clearCookies();
    await page.goto("/dashboard");
    // Without auth, should be redirected to login
    await expect(page).toHaveURL(/login/, { timeout: 5000 });

    // Log back in with the credentials we just created
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should reach the dashboard (setup already completed)
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });
    await expect(page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeVisible();

    await context.close();
  });
});
