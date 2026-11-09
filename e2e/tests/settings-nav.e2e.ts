import { test, expect } from "@playwright/test";

test.describe("Settings tabs", () => {
  test("Account is always a tab, not only after opening it from your name", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    const nav = page.getByRole("navigation", { name: "Settings" });
    await expect(nav.getByRole("link", { name: "Account" })).toBeVisible();

    await nav.getByRole("link", { name: "Account" }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings\/account$/);
    await expect(nav.getByRole("link", { name: "Account" })).toHaveAttribute("aria-current", "page");

    await nav.getByRole("link", { name: "General" }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings\/workspace$/);
    await expect(nav.getByRole("link", { name: "Account" })).toBeVisible();
  });
});
