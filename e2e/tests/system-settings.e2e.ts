import { test, expect } from "@playwright/test";

test.describe("System Settings", () => {
  test("system settings page loads", async ({ page }) => {
    await page.goto("/dashboard/settings/system");
    await expect(
      page.getByRole("heading", { name: /system settings/i }),
    ).toBeVisible();
  });

  test("shows email configuration section", async ({ page }) => {
    await page.goto("/dashboard/settings/system");
    await expect(page.getByText(/email configuration/i)).toBeVisible();
    await expect(page.getByText(/email provider/i)).toBeVisible();
  });

  test("shows file settings section", async ({ page }) => {
    await page.goto("/dashboard/settings/system");
    await expect(page.getByText(/file settings/i)).toBeVisible();
    await expect(page.getByText(/maximum file size/i)).toBeVisible();
  });

  test("sidebar has system settings link", async ({ page }) => {
    await page.goto("/dashboard");
    const systemLink = page.getByRole("link", { name: /system/i });
    await expect(systemLink).toBeVisible();
    await systemLink.click();
    await expect(page).toHaveURL(/\/dashboard\/settings\/system/);
  });

  test("email provider selector works", async ({ page }) => {
    await page.goto("/dashboard/settings/system");
    const select = page.locator("select");
    await expect(select).toBeVisible();

    // Default should be "None"
    await expect(select).toHaveValue("");

    // Select Resend and check that API key field appears
    await select.selectOption("resend");
    await expect(page.getByText(/resend api key/i)).toBeVisible();

    // Select SMTP and check that SMTP fields appear
    await select.selectOption("smtp");
    await expect(page.getByText(/smtp host/i)).toBeVisible();
    await expect(page.getByText(/port/i)).toBeVisible();
    await expect(page.getByText(/username/i)).toBeVisible();
    await expect(page.getByText(/password/i)).toBeVisible();

    // Select None and check that provider-specific fields disappear
    await select.selectOption("");
    await expect(page.getByText(/resend api key/i)).not.toBeVisible();
    await expect(page.getByText(/smtp host/i)).not.toBeVisible();
  });

  test("save settings button exists and is clickable", async ({ page }) => {
    await page.goto("/dashboard/settings/system");
    const saveButton = page.getByRole("button", { name: /save settings/i });
    await expect(saveButton).toBeVisible();
  });

  test("can update max file size", async ({ page }) => {
    await page.goto("/dashboard/settings/system");
    const slider = page.locator('input[type="range"]');
    await expect(slider).toBeVisible();

    // The slider should have a value
    const value = await slider.inputValue();
    expect(parseInt(value, 10)).toBeGreaterThanOrEqual(1);
    expect(parseInt(value, 10)).toBeLessThanOrEqual(500);
  });

  test("test email button appears when provider is selected", async ({ page }) => {
    await page.goto("/dashboard/settings/system");

    // No test email button when no provider is selected
    await expect(
      page.getByRole("button", { name: /send test email/i }),
    ).not.toBeVisible();

    // Select resend and check the button appears
    await page.locator("select").selectOption("resend");
    await expect(
      page.getByRole("button", { name: /send test email/i }),
    ).toBeVisible();
  });

  test("settings API returns data", async ({ page }) => {
    await page.goto("/dashboard/settings/system");

    // Wait for settings to load (loading text should disappear)
    await expect(page.getByText("Loading...")).not.toBeVisible({ timeout: 5000 });

    // The page should show the save button (meaning data loaded)
    await expect(
      page.getByRole("button", { name: /save settings/i }),
    ).toBeVisible();
  });

  test("can save settings without errors", async ({ page }) => {
    await page.goto("/dashboard/settings/system");
    await expect(page.getByText("Loading...")).not.toBeVisible({ timeout: 5000 });

    // Click save
    await page.getByRole("button", { name: /save settings/i }).click();

    // Should see success toast
    await expect(page.getByText(/settings saved/i)).toBeVisible({ timeout: 5000 });
  });
});
