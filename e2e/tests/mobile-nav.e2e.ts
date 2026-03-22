import { test, expect } from "@playwright/test";

test.describe("Mobile Navigation", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("hamburger menu is visible on mobile", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: /open menu/i })).toBeVisible();
  });

  test("desktop sidebar is hidden on mobile", async ({ page }) => {
    await page.goto("/dashboard");
    // Desktop sidebar has the sign-out button directly visible — on mobile it's inside the drawer
    const desktopSidebar = page.locator("aside.hidden.md\\:flex");
    await expect(desktopSidebar).toBeHidden();
  });

  test("drawer opens and closes", async ({ page }) => {
    await page.goto("/dashboard");

    // Open the drawer
    await page.getByRole("button", { name: /open menu/i }).click();

    // Drawer should show the close button
    await expect(page.getByRole("button", { name: /close menu/i })).toBeVisible();

    // Drawer should show nav links (use the drawer container to avoid matching hidden desktop sidebar)
    const drawer = page.locator(".translate-x-0");
    await expect(drawer.getByRole("link", { name: /projects/i })).toBeVisible();

    // Close the drawer
    await page.getByRole("button", { name: /close menu/i }).click();

    // Drawer close button should be hidden again (drawer slides off-screen)
    await expect(page.getByRole("button", { name: /close menu/i })).toBeHidden();
  });

  test("drawer closes on navigation", async ({ page }) => {
    await page.goto("/dashboard");

    // Open the drawer
    await page.getByRole("button", { name: /open menu/i }).click();

    // Click a nav link inside the drawer
    const drawer = page.locator(".translate-x-0");
    await drawer.getByRole("link", { name: /projects/i }).click();

    // Should navigate and close drawer
    await expect(page).toHaveURL(/\/dashboard\/projects/);
    await expect(page.getByRole("button", { name: /close menu/i })).toBeHidden();
  });

  test("org name is shown in top bar", async ({ page }) => {
    await page.goto("/dashboard");
    // The top bar should show the org name or fallback "Atrium"
    // The mobile top bar has a z-40 fixed div containing the org name
    const topBar = page.locator(".md\\:hidden > .fixed.z-40");
    await expect(topBar).toBeVisible();
    // Verify it contains some text (org name or "Atrium" fallback)
    await expect(topBar.locator("span.font-bold")).toBeVisible();
  });
});

test.describe("Desktop Navigation", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("sidebar is visible on desktop", async ({ page }) => {
    await page.goto("/dashboard");
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();
  });

  test("hamburger menu is hidden on desktop", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: /open menu/i })).toBeHidden();
  });
});
