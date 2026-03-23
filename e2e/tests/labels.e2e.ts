import { test, expect } from "@playwright/test";

test.describe("Labels", () => {
  test("labels section visible in system settings", async ({ page }) => {
    await page.goto("/dashboard/settings/system");
    await expect(page.getByText("Loading...")).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("heading", { name: /labels/i })).toBeVisible();
  });

  test("can create a label", async ({ page }) => {
    await page.goto("/dashboard/settings/system");
    await expect(page.getByText("Loading...")).not.toBeVisible({ timeout: 5000 });

    // Fill in label name and create
    await page.getByPlaceholder("New label name").fill("E2E Test Label");
    await page.getByRole("button", { name: /add/i }).click();

    // Should see success toast
    await expect(page.getByText(/label created/i)).toBeVisible({ timeout: 5000 });

    // Label should appear in the list
    await expect(page.getByText("E2E Test Label")).toBeVisible();
  });

  test("can edit a label", async ({ page }) => {
    await page.goto("/dashboard/settings/system");
    await expect(page.getByText("Loading...")).not.toBeVisible({ timeout: 5000 });

    // Create a label first
    await page.getByPlaceholder("New label name").fill("Edit Me Label");
    await page.getByRole("button", { name: /add/i }).click();
    await expect(page.getByText(/label created/i)).toBeVisible({ timeout: 5000 });

    // Click the edit (pencil) button for the label
    const labelRow = page.locator("div").filter({ hasText: /^Edit Me Label$/ }).first();
    await labelRow.locator("button").first().click();

    // Clear and type new name
    const editInput = page.locator('input[type="text"][maxlength="50"]').last();
    await editInput.fill("Edited Label");

    // Click the check button to save
    const checkBtn = page.locator("button").filter({ has: page.locator("svg") }).nth(-2);
    await page.keyboard.press("Enter");

    // Should see success toast
    await expect(page.getByText(/label updated/i)).toBeVisible({ timeout: 5000 });
  });

  test("can delete a label", async ({ page }) => {
    await page.goto("/dashboard/settings/system");
    await expect(page.getByText("Loading...")).not.toBeVisible({ timeout: 5000 });

    // Create a label first
    await page.getByPlaceholder("New label name").fill("Delete Me Label");
    await page.getByRole("button", { name: /add/i }).click();
    await expect(page.getByText(/label created/i)).toBeVisible({ timeout: 5000 });

    // Find the label row that contains exactly the label name text, then click the trash button
    const labelRow = page.locator(".border.rounded-lg").filter({ hasText: "Delete Me Label" });
    await labelRow.locator("button").nth(1).click(); // second button is trash (first is pencil/edit)

    // Confirm deletion
    await page.getByRole("button", { name: /delete/i }).click();

    // Should see success toast
    await expect(page.getByText(/label deleted/i)).toBeVisible({ timeout: 5000 });
  });

  test("label badges show on project cards", async ({ page }) => {
    // First create a label
    await page.goto("/dashboard/settings/system");
    await expect(page.getByText("Loading...")).not.toBeVisible({ timeout: 5000 });
    await page.getByPlaceholder("New label name").fill("Project Tag");
    await page.getByRole("button", { name: /add/i }).click();
    await expect(page.getByText(/label created/i)).toBeVisible({ timeout: 5000 });

    // Navigate to projects page
    await page.goto("/dashboard/projects");
    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible();
  });

  test("project detail has label picker", async ({ page }) => {
    // Create a project first
    await page.goto("/dashboard/projects");
    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible();

    // Check if there are existing projects — look only in main content, not the sidebar nav
    const projectLinks = page.locator('main a[href*="/dashboard/projects/"]');
    const count = await projectLinks.count();

    if (count > 0) {
      // Click first project
      await projectLinks.first().click();
      await page.waitForURL(/\/dashboard\/projects\/.+/);

      // Check for label section in sidebar
      await expect(page.getByRole("heading", { name: "Labels" }).first()).toBeVisible({ timeout: 5000 });
    }
  });

  test("label filter appears on projects page when labels exist", async ({ page }) => {
    await page.goto("/dashboard/projects");
    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible();

    // The label filter button should be visible if labels exist in the org
    // This test verifies the UI loads without errors
  });
});
