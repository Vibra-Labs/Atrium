import { test, expect } from "@playwright/test";

test.describe("Branding", () => {
  test("branding section is visible on branding settings page", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    await expect(page.getByRole("heading", { name: /branding/i })).toBeVisible();
  });

  test("primary color picker is visible on branding settings page", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    await expect(page.getByText(/primary color/i)).toBeVisible();
  });

  // Accent color was removed in #43: it saved, but nothing in the UI ever read
  // the variable it set. Guard against it creeping back without a job to do.
  // An old dashboard tab may still send accentColor for one release. It must
  // be accepted and ignored, not rejected by forbidNonWhitelisted.
  test("PUT still accepts a stale accentColor and ignores it", async ({
    page,
    context,
  }) => {
    await page.request.get("http://localhost:3001/api/branding");
    const csrfToken =
      (await context.cookies()).find((c) => c.name === "csrf-token")?.value ||
      "";

    const res = await page.request.put("http://localhost:3001/api/branding", {
      headers: { "x-csrf-token": csrfToken, "Content-Type": "application/json" },
      data: { primaryColor: "#123456", accentColor: "#abcdef" },
    });
    expect(res.status(), await res.text()).toBe(200);

    const saved = await res.json();
    expect(saved.primaryColor).toBe("#123456");
    expect(saved.accentColor).not.toBe("#abcdef");
  });

  test("accent color picker is gone", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    await expect(page.getByText(/accent color/i)).toHaveCount(0);
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

    // Issue a GET first so the csrf-token cookie is set, then submit it back
    // on the mutating PUT (the API enforces double-submit CSRF).
    await page.request.get("http://localhost:3001/api/branding");
    const csrfToken =
      (await context.cookies()).find((c) => c.name === "csrf-token")?.value ||
      "";

    const putRes = await page.request.put("http://localhost:3001/api/branding", {
      headers: { "x-csrf-token": csrfToken, "Content-Type": "application/json" },
      data: { primaryColor: customPrimary },
    });
    expect(putRes.ok()).toBe(true);

    await page.goto("/dashboard", { waitUntil: "networkidle" });

    const primary = await page.evaluate(() => {
      const target = document.querySelector("main") ?? document.body;
      return getComputedStyle(target).getPropertyValue("--primary").trim();
    });

    expect(primary.toLowerCase()).toBe(customPrimary);
  });
});
