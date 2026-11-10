import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createOwner, getCsrfTokenFromContext } from "./helpers";

const API = "http://localhost:3001/api";
const WEB = "http://localhost:3000";

async function openCustomize(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Customize" }).click();
  await expect(page.getByRole("group", { name: "Dashboard cards" })).toBeVisible();
}

function cardSwitch(page: Page, label: string) {
  return page.getByRole("group", { name: "Dashboard cards" }).getByRole("checkbox", { name: label });
}

test.describe("Customize dashboard", () => {
  test.setTimeout(90000);

  test("hide a card, keep it hidden after reload, then bring it back", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "dash-custom");
    await page.goto(`${WEB}/dashboard`);
    const activity = page.getByRole("heading", { name: "Client activity" });
    await expect(activity).toBeVisible({ timeout: 15000 });

    await openCustomize(page);
    const saved = page.waitForResponse((r) => r.url().includes("/api/dashboard-layout") && r.request().method() === "PUT");
    await cardSwitch(page, "Client activity").uncheck();
    expect((await saved).ok()).toBe(true);
    await expect(activity).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Recent projects" })).toBeVisible({ timeout: 15000 });
    await expect(activity).toHaveCount(0);

    await openCustomize(page);
    await expect(cardSwitch(page, "Client activity")).not.toBeChecked();
    await cardSwitch(page, "Client activity").check();
    await expect(activity).toBeVisible();
    await context.close();
  });

  test("pipeline shows an empty state with a way to add the first deal, and can be hidden", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "dash-pipeline");
    await page.goto(`${WEB}/dashboard`);
    const card = page.getByTestId("pipeline-card");
    await expect(card).toContainText("No potential contracts yet", { timeout: 15000 });

    await card.getByRole("button", { name: "Add a potential contract" }).click();
    const dialog = page.getByRole("dialog", { name: "New potential contract" });
    await expect(dialog.getByRole("button", { name: /Potential contract/ })).toHaveAttribute("aria-pressed", "true");
    await dialog.getByPlaceholder("County RFP: records system").fill("County bid");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/?]+/, { timeout: 15000 });

    await page.goto(`${WEB}/dashboard`);
    await expect(card).toContainText("1 contract", { timeout: 15000 });

    await openCustomize(page);
    await cardSwitch(page, "Pipeline").uncheck();
    await expect(card).toHaveCount(0);
    await context.close();
  });

  test("hiding every card shows a way back", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "dash-empty");
    const put = await page.request.put(`${API}/dashboard-layout`, {
      data: { hidden: ["stats", "attention", "weeklyUpdates", "recentProjects", "activity", "pipeline", "thisWeek"] },
      headers: { "x-csrf-token": await getCsrfTokenFromContext(context) },
    });
    expect(put.ok()).toBe(true);
    await page.goto(`${WEB}/dashboard`);
    await expect(page.getByText("Every card is hidden. Use Customize to bring some back.")).toBeVisible({ timeout: 15000 });
    await context.close();
  });

  test("rejects unknown card names", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "dash-bad");
    const put = await page.request.put(`${API}/dashboard-layout`, {
      data: { hidden: ["notACard"] },
      headers: { "x-csrf-token": await getCsrfTokenFromContext(context) },
    });
    expect(put.status()).toBe(400);
    await context.close();
  });
});
