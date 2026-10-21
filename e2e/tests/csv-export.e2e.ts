import { test, expect } from "@playwright/test";

test.describe("CSV Export", () => {
  test("projects export button exists", async ({ page }) => {
    await page.goto("/dashboard/projects");
    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible();
    await expect(page.getByTitle("Export CSV")).toBeVisible();
  });

  // Contacts export replaces the old People export: clients are contacts with portal access.
  test("contacts export button exists", async ({ page }) => {
    await page.goto("/dashboard/contacts");
    await expect(page.getByRole("heading", { name: /contacts/i })).toBeVisible();
    await expect(page.getByTitle("Export CSV")).toBeVisible();
  });

  test("projects CSV download returns valid CSV", async ({ page }) => {
    await page.goto("/dashboard/projects");
    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByTitle("Export CSV").click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain(".csv");

    const path = await download.path();
    if (path) {
      const fs = await import("fs");
      const content = fs.readFileSync(path, "utf-8");
      expect(content).toContain("Name,Status,Description");
    }
  });

  test("contacts CSV download includes portal access", async ({ page }) => {
    await page.goto("/dashboard/contacts");
    await expect(page.getByRole("heading", { name: /contacts/i })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByTitle("Export CSV").click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain(".csv");

    const path = await download.path();
    if (path) {
      const fs = await import("fs");
      const content = fs.readFileSync(path, "utf-8");
      expect(content).toContain("Name,First name,Last name,Email");
      expect(content.split("\n")[0]).toContain("Portal access");
    }
  });
});

test("the old People export endpoint is gone", async ({ request }) => {
  const res = await request.get("http://localhost:3001/api/clients/export");
  expect(res.ok()).toBe(false);
});
