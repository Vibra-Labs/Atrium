import { test, expect } from "@playwright/test";

// The shared API server bootstraps the suite via POST /onboarding/signup, so it
// runs with signups enabled. To exercise the disabled UI without a second API,
// intercept the public /health/config response the signup page reads.
test.describe("signup disabled state", () => {
  // Visit as a logged-out user — /signup is public.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("shows the disabled message when signups are off", async ({ page }) => {
    await page.route("**/api/health/config", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ billingEnabled: false, signupEnabled: false }),
      }),
    );

    await page.goto("/signup");

    await expect(
      page.getByRole("heading", { name: /signups are disabled/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /go to sign in/i }),
    ).toBeVisible();
    // The account form must not render.
    await expect(page.getByLabel(/agency \/ company name/i)).toHaveCount(0);
  });

  test("shows the signup form when signups are enabled", async ({ page }) => {
    await page.route("**/api/health/config", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ billingEnabled: false, signupEnabled: true }),
      }),
    );

    await page.goto("/signup");

    await expect(
      page.getByRole("heading", { name: /create your account/i }),
    ).toBeVisible();
  });
});
