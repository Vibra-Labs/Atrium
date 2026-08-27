import { test, expect, type Page } from "@playwright/test";
import { getCsrfTokenFromContext } from "./helpers";

const API = "http://localhost:3001";

/**
 * The global-setup account starts in a single organization, so the switcher
 * renders as a plain label. These tests create a second org through the
 * settings page and then exercise switching between the two.
 *
 * A newly created org has setupCompleted=false, so the owner is sent to the
 * setup wizard straight after creating it — complete it via the API (the same
 * path global-setup uses) to get back to the dashboard.
 */
async function completeSetupIfNeeded(page: Page): Promise<void> {
  if (!page.url().includes("/setup")) return;
  // Any GET sets the csrf-token cookie the mutating POST has to echo back.
  await page.request.get(`${API}/api/setup/status`);
  const csrf = await getCsrfTokenFromContext(page.context());
  await page.request.post(`${API}/api/setup/complete`, {
    headers: { "x-csrf-token": csrf },
  });
  await page.goto("/dashboard", { waitUntil: "networkidle" });
}

async function createOrg(page: Page, name: string): Promise<void> {
  // A previous test may have left a freshly created org mid-wizard, which
  // redirects every dashboard route to /setup. Clear that first.
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await completeSetupIfNeeded(page);

  await page.goto("/dashboard/settings/organizations");
  // Placeholder, not label: the setup wizard also has an "Organization Name"
  // field, and a label match would hit it when a redirect lands us there.
  await page.getByPlaceholder("Company name").fill(name);
  await page.getByRole("button", { name: /^create$/i }).click();
  // Anchored: the settings URL we start on also contains "dashboard",
  // so an unanchored match would resolve before the create even lands.
  await page.waitForURL(/\/(dashboard|setup)$/, { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  await completeSetupIfNeeded(page);
}

test.describe("Organizations", () => {
  test("settings has an Organizations tab listing the current org", async ({
    page,
  }) => {
    await page.goto("/dashboard/settings/organizations");
    await expect(
      page.getByRole("heading", { name: /^organizations$/i }),
    ).toBeVisible();
    await expect(page.getByText(/current/i)).toBeVisible();
  });

  test("a single-org user gets no switcher dropdown", async ({ page }) => {
    // Later tests in this file create organizations, so only assert this while
    // the account genuinely has one — otherwise the expectation is wrong
    // rather than the code.
    const orgs = await page.request
      .get(`${API}/api/auth/organization/list`)
      .then((r) => r.json());
    test.skip(orgs.length !== 1, "account already has more than one org");

    await page.goto("/dashboard");
    // The org name still shows, it just isn't a button.
    await expect(
      page.getByRole("button", { name: /switch organization/i }),
    ).toHaveCount(0);
  });

  test("creating an organization makes it active and reveals the switcher", async ({
    page,
  }) => {
    const name = `Second Co ${Date.now()}`;
    await createOrg(page, name);

    const switcher = page.getByRole("button", {
      name: /switch organization/i,
    });
    await expect(switcher).toBeVisible();
    await expect(switcher).toContainText(name.slice(0, 6));
  });

  test("switching organizations changes the active one", async ({ page }) => {
    const name = `Switch Co ${Date.now()}`;
    await createOrg(page, name);

    await page.getByRole("button", { name: /switch organization/i }).click();
    await page.getByRole("option", { name: /E2E Test Org/ }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: 20000 });
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("button", { name: /switch organization/i }),
    ).toContainText("E2E Test");
  });

  test("the switcher links to the create-organization page", async ({
    page,
  }) => {
    await createOrg(page, `Link Co ${Date.now()}`);

    await page.getByRole("button", { name: /switch organization/i }).click();
    await page.getByRole("link", { name: /new organization/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings\/organizations$/);
  });

  test("mobile drawer exposes the switcher", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await createOrg(page, `Mobile Co ${Date.now()}`);

    await page.getByRole("button", { name: /open menu/i }).click();
    const switcher = page.getByRole("button", {
      name: /switch organization/i,
    });
    await expect(switcher).toBeVisible();

    await switcher.click();
    await page.getByRole("option", { name: /E2E Test Org/ }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: 20000 });
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("E2E Test Org").first()).toBeVisible();
  });
});
