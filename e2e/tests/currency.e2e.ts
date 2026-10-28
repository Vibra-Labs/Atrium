import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const API = "http://localhost:3001/api";

// The shared API server runs with the default currency. To exercise a
// configured one without a second API, intercept the public /health/config
// response the web app reads.
// Other specs leave invoices on the shared account, so assert on the symbol of
// the Outstanding card rather than an exact amount.
function outstandingCard(page: Page): Locator {
  return page.getByTestId("outstanding-card");
}

test.describe("configurable currency", () => {
  test("health config exposes the instance currency", async ({ request }) => {
    const res = await request.get(`${API}/health/config`);
    expect(res.ok()).toBeTruthy();
    const config: { currency: string } = await res.json();
    expect(config.currency).toBe("usd");
  });

  test("dashboard shows USD amounts by default", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(outstandingCard(page)).toContainText("$");
  });

  test("dashboard formats amounts in the configured currency", async ({ page }) => {
    await page.route("**/api/health/config", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ billingEnabled: false, signupEnabled: true, currency: "eur" }),
      }),
    );

    await page.goto("/dashboard");
    await expect(outstandingCard(page)).toContainText("€");
    await expect(outstandingCard(page)).not.toContainText("$");
  });
});
