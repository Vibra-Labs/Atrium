import { test, expect } from "@playwright/test";

test.describe("Theme toggle", () => {
  test("switches between light and dark and persists across reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/dashboard");

    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/);

    await page.getByRole("button", { name: /switch to dark mode/i }).first().click();
    await expect(html).toHaveClass(/dark/);

    await page.reload();
    await expect(html).toHaveClass(/dark/);

    await page.getByRole("button", { name: /switch to light mode/i }).first().click();
    await expect(html).not.toHaveClass(/dark/);
  });
});
