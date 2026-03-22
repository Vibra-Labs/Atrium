import { test, expect } from "@playwright/test";

test.describe("CSV Export", () => {
  test("projects export button exists", async ({ page }) => {
    await page.goto("/dashboard/projects");
    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible();
    await expect(page.getByTitle("Export CSV")).toBeVisible();
  });

  test("people export button exists", async ({ page }) => {
    await page.goto("/dashboard/clients");
    await expect(page.getByRole("heading", { name: /people/i })).toBeVisible();
    await expect(page.getByTitle("Export CSV")).toBeVisible();
  });

  test("projects CSV download returns valid CSV", async ({ page }) => {
    await page.goto("/dashboard/projects");
    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByTitle("Export CSV").click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("projects.csv");

    const content = await download.path().then((p) => (p ? Bun.file(p).text() : ""));
    expect(content).toContain("Name,Status,Description");
  });

  test("people CSV download returns valid CSV", async ({ page }) => {
    await page.goto("/dashboard/clients");
    await expect(page.getByRole("heading", { name: /people/i })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByTitle("Export CSV").click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("people.csv");

    const content = await download.path().then((p) => (p ? Bun.file(p).text() : ""));
    expect(content).toContain("Name,Email,Role");
  });
});
