import { test, expect } from "@playwright/test";

test.describe("Mobile Navigation", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("hamburger menu is visible on mobile", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: /open menu/i })).toBeVisible();
  });

  test("desktop sidebar is hidden on mobile", async ({ page }) => {
    await page.goto("/dashboard");
    const desktopSidebar = page.locator("aside.hidden.md\\:flex");
    await expect(desktopSidebar).toBeHidden();
  });

  test("drawer opens and closes", async ({ page }) => {
    await page.goto("/dashboard");

    // Open the drawer
    await page.getByRole("button", { name: /open menu/i }).click();

    // Drawer should be open (has translate-x-0 class)
    const drawer = page.locator(".fixed.z-50.w-64");
    await expect(drawer).toHaveClass(/translate-x-0/);

    // Close the drawer
    await page.getByRole("button", { name: /close menu/i }).click();

    // Drawer should be closed (has -translate-x-full class)
    await expect(drawer).toHaveClass(/-translate-x-full/, { timeout: 5000 });
  });

  test("drawer closes on navigation", async ({ page }) => {
    await page.goto("/dashboard");

    // Open the drawer
    await page.getByRole("button", { name: /open menu/i }).click();

    const drawer = page.locator(".fixed.z-50.w-64");
    await expect(drawer).toHaveClass(/translate-x-0/);

    // Click a nav link inside the drawer
    await drawer.getByRole("link", { name: /projects/i }).click();

    // Should navigate and close drawer
    await expect(page).toHaveURL(/\/dashboard\/projects/);
    await expect(drawer).toHaveClass(/-translate-x-full/, { timeout: 5000 });
  });

  test("org name is shown in top bar", async ({ page }) => {
    await page.goto("/dashboard");
    const topBar = page.locator(".fixed.z-40.h-14");
    await expect(topBar).toBeVisible();
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
