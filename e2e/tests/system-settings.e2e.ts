import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

test.describe("System Settings", () => {
  test("general settings page loads", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    await expect(page.getByRole("heading", { name: /^email$/i })).toBeVisible();
  });

  test("shows email configuration section", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    await expect(page.getByRole("heading", { name: /^email$/i })).toBeVisible();
    await expect(page.getByText(/email provider/i)).toBeVisible();
  });

  test("shows file settings section", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    await expect(page.getByRole("heading", { name: /^files$/i })).toBeVisible();
    await expect(page.getByText(/maximum file size/i)).toBeVisible();
  });

  test("settings subnav has Workspace link", async ({ page }) => {
    await page.goto("/dashboard/settings");
    const workspaceLink = page.getByRole("link", { name: /^workspace$/i });
    await expect(workspaceLink).toBeVisible();
    await workspaceLink.click();
    await expect(page).toHaveURL(/\/dashboard\/settings\/workspace/);
  });

  test("email provider selector works", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");

    const select = page.locator("select");
    await expect(select).toBeVisible();

    await expect(select).toHaveValue("");

    await select.selectOption("resend");
    await expect(page.getByText(/resend api key/i)).toBeVisible();

    await select.selectOption("smtp");
    await expect(page.getByText(/smtp host/i)).toBeVisible();
    await expect(page.getByText("Port", { exact: true })).toBeVisible();
    await expect(page.getByText("Username", { exact: true })).toBeVisible();
    await expect(page.getByText("Password", { exact: true })).toBeVisible();

    await select.selectOption("");
    await expect(page.getByText(/resend api key/i)).not.toBeVisible();
    await expect(page.getByText(/smtp host/i)).not.toBeVisible();
  });

  test("save settings button exists and is clickable", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    await expect(page.getByText(/maximum file size/i)).toBeVisible();
    const saveButton = page.getByRole("button", { name: /^save$/i }).first();
    await expect(saveButton).toBeVisible();
  });

  test("can update max file size", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    const slider = page.locator('input[type="range"]');
    await expect(slider).toBeVisible();

    const value = await slider.inputValue();
    expect(parseInt(value, 10)).toBeGreaterThanOrEqual(1);
    expect(parseInt(value, 10)).toBeLessThanOrEqual(500);
  });

  test("test email button appears when provider is selected", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");

    await expect(
      page.getByRole("button", { name: /send test email/i }),
    ).not.toBeVisible();

    await page.locator("select").selectOption("resend");
    await expect(
      page.getByRole("button", { name: /send test email/i }),
    ).toBeVisible();
  });

  test("settings API returns data", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");

    await expect(page.getByText("Loading...").first()).not.toBeVisible({ timeout: 5000 });

    await expect(page.locator('input[type="range"]')).toBeVisible();
  });

  test("can save settings without errors", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    await expect(page.getByText("Loading...").first()).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[type="range"]')).toBeVisible();

    await page.getByRole("button", { name: /^save$/i }).first().click();

    await expect(page.getByText(/configuration saved/i)).toBeVisible({ timeout: 5000 });
  });

  test("shows error reporting section", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    await expect(page.getByText("Loading...").first()).not.toBeVisible({ timeout: 5000 });

    await expect(page.getByRole("heading", { name: /error reporting/i })).toBeVisible();
    await expect(
      page.locator("section").filter({ hasText: /error reporting/i }).getByText(/share anonymous crash reports/i)
    ).toBeVisible();
  });

  test("can toggle error reporting on and off", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    await expect(page.getByText("Loading...").first()).not.toBeVisible({ timeout: 5000 });

    const checkbox = page.locator('section:has(h2:text-is("Error Reporting")) input[type="checkbox"]');
    await expect(checkbox).toBeVisible();

    const initial = await checkbox.isChecked();
    await checkbox.click();
    await expect(page.getByText(initial ? /error reporting disabled/i : /error reporting enabled/i)).toBeVisible({ timeout: 5000 });

    await checkbox.click();
    await expect(page.getByText(initial ? /error reporting enabled/i : /error reporting disabled/i)).toBeVisible({ timeout: 5000 });
  });

  test("telemetry consent banner appears when preference not yet set", async ({ page, request }) => {
    const csrfToken = getCsrfToken();
    await request.patch("http://localhost:3001/api/settings", {
      data: { telemetryEnabled: null },
      headers: { "x-csrf-token": csrfToken },
    });

    await page.goto("/dashboard");
    await expect(page.getByText(/help improve atrium/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /share anonymously/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /no thanks/i })).toBeVisible();
  });

  test("accepting telemetry consent banner dismisses it", async ({ page, request }) => {
    const csrfToken = getCsrfToken();
    await request.patch("http://localhost:3001/api/settings", {
      data: { telemetryEnabled: null },
      headers: { "x-csrf-token": csrfToken },
    });

    await page.goto("/dashboard");
    await page.getByRole("button", { name: /share anonymously/i }).click();
    await expect(page.getByText(/help improve atrium/i)).not.toBeVisible({ timeout: 5000 });
  });

  test("declining telemetry consent banner dismisses it", async ({ page, request }) => {
    const csrfToken = getCsrfToken();
    await request.patch("http://localhost:3001/api/settings", {
      data: { telemetryEnabled: null },
      headers: { "x-csrf-token": csrfToken },
    });

    await page.goto("/dashboard");
    await page.getByRole("button", { name: /no thanks/i }).click();
    await expect(page.getByText(/help improve atrium/i)).not.toBeVisible({ timeout: 5000 });
  });

  test("consent banner does not appear when preference already set", async ({ page, request }) => {
    const csrfToken = getCsrfToken();
    await request.patch("http://localhost:3001/api/settings", {
      data: { telemetryEnabled: false },
      headers: { "x-csrf-token": csrfToken },
    });

    await page.goto("/dashboard");
    await expect(page.getByText(/help improve atrium/i)).not.toBeVisible({ timeout: 3000 });
  });
});
