import { test, expect } from "@playwright/test";

test.describe("Branding", () => {
  test("branding section is visible on branding settings page", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    await expect(page.getByRole("heading", { name: /branding/i })).toBeVisible();
  });

  test("color pickers are visible on branding settings page", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    await expect(page.getByText(/primary color/i)).toBeVisible();
    await expect(page.getByText(/accent color/i)).toBeVisible();
  });

  test("logo upload area is visible on branding settings page", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    await expect(page.getByText("Company Logo", { exact: true })).toBeVisible();
  });

  test("preview bar is visible on branding settings page", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    await expect(page.getByText(/preview/i)).toBeVisible();
  });

  test("sidebar does NOT show branding link", async ({ page }) => {
    await page.goto("/dashboard");
    const sidebarBrandingLink = page.locator("nav").getByRole("link", { name: /^branding$/i });
    await expect(sidebarBrandingLink).not.toBeVisible();
  });

  test("dashboard layout applies saved primary color as CSS variable", async ({
    page,
    context,
  }) => {
    const customPrimary = "#ff00aa";
    const customAccent = "#0044ff";

    // Issue a GET first so the csrf-token cookie is set, then submit it back
    // on the mutating PUT (the API enforces double-submit CSRF).
    await page.request.get("http://localhost:3001/api/branding");
    const csrfToken =
      (await context.cookies()).find((c) => c.name === "csrf-token")?.value ||
      "";

    const putRes = await page.request.put("http://localhost:3001/api/branding", {
      headers: { "x-csrf-token": csrfToken, "Content-Type": "application/json" },
      data: { primaryColor: customPrimary, accentColor: customAccent },
    });
    expect(putRes.ok()).toBe(true);

    await page.goto("/dashboard", { waitUntil: "networkidle" });

    const { primary, accent } = await page.evaluate(() => {
      const target = document.querySelector("main") ?? document.body;
      const cs = getComputedStyle(target);
      return {
        primary: cs.getPropertyValue("--primary").trim(),
        accent: cs.getPropertyValue("--accent").trim(),
      };
    });

    expect(primary.toLowerCase()).toBe(customPrimary);
    expect(accent.toLowerCase()).toBe(customAccent);
  });
});
