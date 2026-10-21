import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createPortalClientProject } from "./helpers";
import type { PortalClientProject } from "./helpers";

const WEB = "http://localhost:3000";

/**
 * Notification emails and in-app notifications deep-link into a specific tab of
 * the portal project page (?tab=invoices, ?tab=files, ?tab=tasks). Without that
 * the recipient lands on Updates and has to find what the notification was
 * about — see issue #56.
 *
 * No clicking here: the tab comes from the URL, so these assertions only wait
 * for hydration rather than racing a click against it.
 */
test.describe("Portal project tab deep links", () => {
  let portal: PortalClientProject;
  let path: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120000);
    portal = await createPortalClientProject(browser, "deeplink", "Portal Deep Link E2E");
    path = `${WEB}/portal/projects/${portal.projectId}`;
  });

  test.afterAll(async () => {
    await portal?.close();
  });

  test("?tab=invoices opens the Invoices tab", async () => {
    const page: Page = portal.client;
    await page.goto(`${path}?tab=invoices`);

    // The panel heading, not the tab button of the same name.
    await expect(
      page.getByRole("heading", { name: "Invoices", exact: true }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("?tab=files opens the Files tab", async () => {
    const page: Page = portal.client;
    await page.goto(`${path}?tab=files`);

    // Upload is a <label> wrapping a hidden file input, not a button.
    await expect(page.getByText("Upload File", { exact: true })).toBeVisible({
      timeout: 15000,
    });
  });

  test("?tab=tasks opens the Tasks tab", async () => {
    const page: Page = portal.client;
    await page.goto(`${path}?tab=tasks`);

    await expect(
      page.getByRole("button", { name: /new request/i }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("an unknown ?tab= value falls back to Updates", async () => {
    const page: Page = portal.client;
    await page.goto(`${path}?tab=not-a-tab`);

    await expect(
      page.getByRole("button", { name: /add update/i }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("heading", { name: "Invoices", exact: true }),
    ).toHaveCount(0);
  });
});
