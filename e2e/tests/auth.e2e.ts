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
    await expect(
      page.getByRole("heading", { name: /create your account/i }),
    ).toBeVisible();
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
    await page.getByLabel(/your name/i).fill("Login Test");
    await page.getByLabel(/agency/i).fill("Login Test Org");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /create account/i }).click();

    // Should redirect to verify-email page after signup
    await expect(page).toHaveURL(/verify-email/, { timeout: 10000 });
    await expect(
      page.getByRole("heading", { name: /check your email/i }),
    ).toBeVisible();

    // Log out by clearing cookies and verify redirect
    await context.clearCookies();
    await page.goto("/dashboard");
    // Without auth, should be redirected to login
    await expect(page).toHaveURL(/login/, { timeout: 5000 });

    // Log back in with the credentials we just created
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should reach the dashboard again
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();

    await context.close();
  });
});
