import { test, expect } from "@playwright/test";
import { createOwner, inviteAndAcceptClient, openClientContact } from "./helpers";

const WEB = "http://localhost:3000";

// Portal access is a property of a contact: listed, filtered and managed on Contacts.
test.describe("Portal access on contacts", () => {
  test.setTimeout(120000);

  test("contacts list filters and badges clients by portal access", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "access-owner");
    const { clientEmail } = await inviteAndAcceptClient(browser, page, "access-client");

    await page.goto(`${WEB}/dashboard/contacts`);
    const filter = page.getByLabel("Filter by portal access");
    await filter.selectOption("portal");
    const row = page.getByTestId("contact-row").filter({ hasText: "Test Client VAC" });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("portal-badge")).toHaveText("Portal");

    await filter.selectOption("none");
    await expect(page.getByTestId("contact-row").filter({ hasText: "Test Client VAC" })).toHaveCount(0);

    // The old People page lands on the same filtered list.
    await page.goto(`${WEB}/dashboard/clients`);
    await page.waitForURL("**/dashboard/contacts?access=portal");
    await expect(page.getByLabel("Filter by portal access")).toHaveValue("portal");
    await expect(page.getByTestId("contact-row").filter({ hasText: "Test Client VAC" })).toBeVisible();

    await openClientContact(page, clientEmail);
    const access = page.getByTestId("portal-access");
    await expect(access).toContainText("Portal access · joined");
    await expect(access.getByRole("button", { name: "View as client" })).toBeVisible();
    await expect(access.getByRole("button", { name: "Send password reset link" })).toBeVisible();
    await context.close();
  });

  test("removing portal access keeps the contact as a past client", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "remove-owner");
    const { clientEmail } = await inviteAndAcceptClient(browser, page, "remove-client");

    await openClientContact(page, clientEmail);
    await page.getByTestId("portal-access").getByRole("button", { name: "Remove portal access" }).click();
    // The confirm modal is worded as removing access, not deleting the client.
    const dialog = page.getByRole("dialog", { name: "Remove portal access" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/contact, notes and history stay/)).toBeVisible();
    await dialog.getByRole("button", { name: "Remove portal access" }).click();

    await expect(page.getByText("Portal access removed")).toBeVisible();
    await expect(page.getByTestId("portal-access")).toHaveCount(0);
    await expect(page.getByTestId("contact-status")).toHaveText("Past client");
    await expect(page.getByRole("button", { name: "Invite to portal" })).toBeVisible();

    const members = (await (await page.request.get("http://localhost:3001/api/clients?limit=100")).json()) as {
      data: { role: string }[];
    };
    expect(members.data.filter((m) => m.role === "member")).toHaveLength(0);
    await context.close();
  });
});
