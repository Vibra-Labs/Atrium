import { test, expect } from "@playwright/test";

test.describe("Portal project status", () => {
  test("shows a single pill with the project's current status", async ({ page, request }) => {
    const statusesRes = await request.get("http://localhost:3001/api/projects/statuses");
    expect(statusesRes.ok()).toBeTruthy();
    const statuses: { name: string }[] = await statusesRes.json();
    const names = statuses.map((s) => s.name);

    await page.goto("/portal/projects");
    const link = page.locator("a[href*='/portal/projects/']").first();
    test.skip(
      !(await link.isVisible({ timeout: 10000 }).catch(() => false)),
      "no portal project available for this account",
    );
    await link.click();
    await expect(page).toHaveURL(/\/portal\/projects\/[^/]+$/);

    const aside = page.locator("aside").first();
    await expect(aside.getByRole("button", { name: /^back$/i })).toBeVisible({ timeout: 15000 });

    // Exactly one status name is rendered in the sidebar, not the whole list.
    let visible = 0;
    for (const name of names) {
      visible += await aside.getByText(name, { exact: true }).count();
    }
    expect(visible).toBe(1);
  });
});
