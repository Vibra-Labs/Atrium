import { test, expect } from "@playwright/test";

/**
 * Notification emails and in-app notifications deep-link into a specific tab of
 * the portal project page (?tab=invoices, ?tab=files, ?tab=tasks). Without that
 * the recipient lands on Updates and has to find what the notification was
 * about — see issue #56.
 *
 * No clicking here: the tab comes from the URL, so these assertions only wait
 * for hydration rather than racing a click against it.
 */
test.describe("Portal project tab deep links", () => {
  async function firstProjectPath(
    page: import("@playwright/test").Page,
  ): Promise<string | null> {
    await page.goto("/portal/projects");
    const link = page.locator("a[href*='/portal/projects/']").first();
    if (!(await link.isVisible({ timeout: 10000 }).catch(() => false))) {
      return null;
    }
    return link.getAttribute("href");
  }

  test("?tab=invoices opens the Invoices tab", async ({ page }) => {
    const path = await firstProjectPath(page);
    test.skip(!path, "no portal project available for this account");

    await page.goto(`${path}?tab=invoices`);

    // The panel heading, not the tab button of the same name.
    await expect(
      page.getByRole("heading", { name: "Invoices" }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("?tab=files opens the Files tab", async ({ page }) => {
    const path = await firstProjectPath(page);
    test.skip(!path, "no portal project available for this account");

    await page.goto(`${path}?tab=files`);

    // Upload is a <label> wrapping a hidden file input, not a button.
    await expect(page.getByText(/upload file/i).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("an unknown ?tab= value falls back to Updates", async ({ page }) => {
    const path = await firstProjectPath(page);
    test.skip(!path, "no portal project available for this account");

    await page.goto(`${path}?tab=not-a-tab`);

    await expect(
      page.getByRole("button", { name: /add update/i }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("heading", { name: "Invoices" }),
    ).toHaveCount(0);
  });
});
