import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// Signup only creates the account: the plan is chosen inside the app. A link
// from the pricing page keeps its plan and goes to checkout after signup.

async function openSignup(page: Page, path: string): Promise<void> {
  await page.route("**/api/health/config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ billingEnabled: true, signupEnabled: true }),
    }),
  );
  // The page renders before it knows billing is on, so wait for that before asserting.
  const configLoaded = page.waitForResponse("**/api/health/config");
  await page.goto(path);
  await configLoaded;
  await expect(page.getByLabel("Agency / Company Name")).toBeVisible();
}

test.describe("signup without a plan step", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("asks only for the account, even when billing is on", async ({ page }) => {
    await openSignup(page, "/signup");
    await expect(page.getByRole("heading", { name: /choose your plan/i })).toHaveCount(0);
    await expect(page.getByText(/go to checkout/i)).toHaveCount(0);
  });

  test("a pricing-page link for Pro says checkout comes after the account", async ({ page }) => {
    await openSignup(page, "/signup?plan=pro");
    await expect(page.getByText("You'll go to checkout for Pro after creating your account")).toBeVisible();
  });

  test("a link for the Free plan is a plain signup", async ({ page }) => {
    await openSignup(page, "/signup?plan=free");
    await expect(page.getByText(/go to checkout/i)).toHaveCount(0);
  });

  test("a Pro signup sends the plan with the new account", async ({ page }) => {
    let sentPlan: string | undefined;
    await page.route("**/api/onboarding/signup", async (route) => {
      sentPlan = (route.request().postDataJSON() as { planSlug?: string }).planSlug;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ success: true }) });
    });
    await page.route("**/setup", (route) => route.fulfill({ status: 200, body: "setup" }));
    await openSignup(page, "/signup?plan=pro");
    await page.getByLabel("Your Name").fill("Pat Pricing");
    await page.getByLabel("Email").fill(`pricing-${Date.now()}@test.local`);
    await page.getByLabel("Password").fill("PricingPass123!");
    await page.getByLabel("Agency / Company Name").fill("Pricing Co");
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect.poll(() => sentPlan).toBe("pro");
  });
});
