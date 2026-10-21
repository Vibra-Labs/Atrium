import { test, expect } from "@playwright/test";
import { createOwner, getCsrfToken, inviteAndAcceptClient, openClientContact, signIn } from "./helpers";

const API = "http://localhost:3001/api";

// A portal client's profile (portal settings) is their contact in the workspace.
test.describe("Client profiles", () => {
  test.describe("Portal settings profile", () => {
    test("portal settings page shows profile section", async ({ page }) => {
      await page.goto("/portal/settings");
      await expect(page.getByText(/your profile/i)).toBeVisible({ timeout: 5000 });
    });

    test("portal settings has profile fields", async ({ page }) => {
      await page.goto("/portal/settings");
      await expect(page.getByText(/your profile/i)).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/company/i)).toBeVisible();
      await expect(page.getByText(/phone/i)).toBeVisible();
    });
  });

  test.describe("API as staff", () => {
    test("staff have no client profile: reads are empty", async ({ request }) => {
      const res = await request.get(`${API}/clients/me/profile`);
      expect(res.ok()).toBeTruthy();
      expect(await res.json()).toEqual({ company: null, phone: null, address: null, website: null, description: null });
    });

    test("staff cannot write a client profile", async ({ request }) => {
      const res = await request.put(`${API}/clients/me/profile`, {
        data: { company: "E2E Test Company" },
        headers: { "x-csrf-token": getCsrfToken() },
      });
      expect(res.status()).toBe(403);
    });

    test("the staff profile endpoints for one client are gone", async ({ request }) => {
      const res = await request.get(`${API}/clients/some-user/profile`);
      expect(res.ok()).toBe(false);
    });
  });

  test("a client's portal self-edit shows on the owner's contact page", async ({ browser }) => {
    test.setTimeout(120000);
    const { context: ownerCtx, page: ownerPage } = await createOwner(browser, "profile-owner");
    const { clientEmail, password } = await inviteAndAcceptClient(browser, ownerPage, "profile-client");
    const company = `Self Edited Co ${Date.now()}`;

    const { context: clientCtx, page: clientPage } = await signIn(browser, clientEmail, password);
    await clientPage.goto("http://localhost:3000/portal/settings");
    await expect(clientPage.getByText(/your profile/i)).toBeVisible({ timeout: 10000 });
    await clientPage.getByLabel("Company", { exact: true }).fill(company);
    await clientPage.getByLabel("Phone", { exact: true }).fill("555-0199");
    await clientPage.getByLabel("Description", { exact: true }).fill("We bake bread.");
    await clientPage.getByRole("button", { name: "Save Profile" }).click();
    await expect(clientPage.getByText("Profile updated")).toBeVisible();

    // The API answers with the stored contact fields and nothing else.
    const res = await clientPage.request.get(`${API}/clients/me/profile`);
    expect(await res.json()).toEqual({
      company,
      phone: "555-0199",
      address: null,
      website: null,
      description: "We bake bread.",
    });
    await clientCtx.close();

    await openClientContact(ownerPage, clientEmail);
    await expect(ownerPage.locator("h1")).toContainText(company);
    await expect(ownerPage.getByTestId("contact-details")).toContainText("555-0199");
    await expect(ownerPage.getByTestId("contact-about")).toHaveText("We bake bread.");
    // CRM fields stay the workspace's.
    await expect(ownerPage.getByTestId("contact-status")).toHaveText("Client");
    await ownerCtx.close();
  });
});
