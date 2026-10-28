import { test, expect } from "@playwright/test";

test.describe("Branding", () => {
  test("branding settings page shows logo, brand color and custom domain", async ({ page }) => {
    await page.goto("/dashboard/settings/branding");
    await expect(page.getByRole("heading", { level: 1, name: "Your client portal" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Logo", exact: true })).toBeVisible();
    await expect(page.getByLabel("Hide logo in the sidebar and portal header")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Brand color", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Custom domain", exact: true })).toBeVisible();
  });

  test("branding page shows the branded login link for this workspace", async ({ page }) => {
    const org = await (await page.request.get("http://localhost:3001/api/organization/current")).json();
    test.skip(!org.slug, "Workspace has no slug");
    await page.goto("/dashboard/settings/branding");
    await expect(page.getByRole("heading", { name: "Branded login link" })).toBeVisible();
    await expect(page.getByText(`/login/${org.slug}`)).toBeVisible();
  });

  test("custom domain shows its real status, not a hard-coded verified badge", async ({ page }) => {
    await page.goto("/dashboard/settings/branding");
    await expect(page.getByRole("heading", { name: "Custom domain", exact: true })).toBeVisible();
    // A new workspace has no domain, so nothing can be verified yet.
    await expect(page.getByText("SSL certificate active")).toHaveCount(0);
  });

  test("general settings no longer duplicates logo, color or domain", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace");
    await expect(page.getByRole("heading", { name: "Workspace", exact: true })).toBeVisible();
    await expect(page.getByText("Company Logo", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/primary color/i)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /custom domain/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Branding", exact: true }).last()).toHaveAttribute(
      "href",
      "/dashboard/settings/branding",
    );
  });

  test("hiding the logo saves from the branding page", async ({ page }) => {
    await page.goto("/dashboard/settings/branding");
    const toggle = page.getByLabel("Hide logo in the sidebar and portal header");
    const wasHidden = await toggle.isChecked();
    await toggle.setChecked(!wasHidden);
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(page.getByText("Branding settings saved")).toBeVisible();
    const saved = await (await page.request.get("http://localhost:3001/api/branding")).json();
    expect(saved.hideLogo).toBe(!wasHidden);

    // Put it back so other tests see the default.
    await toggle.setChecked(wasHidden);
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(page.getByText("Branding settings saved").first()).toBeVisible();
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
    await page.goto("/dashboard/settings/branding");
    await expect(page.getByRole("heading", { name: "Brand color", exact: true })).toBeVisible();
    await expect(page.getByText(/accent color/i)).toHaveCount(0);
  });

  test("full portal preview link is visible on branding settings page", async ({ page }) => {
    await page.goto("/dashboard/settings/branding");
    await expect(page.getByRole("button", { name: /open the full portal preview/i })).toBeVisible();
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
