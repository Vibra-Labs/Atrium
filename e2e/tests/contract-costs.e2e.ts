import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createOwner, getCsrfTokenFromContext } from "./helpers";

const API = "http://localhost:3001/api";
const WEB = "http://localhost:3000";

async function headersFor(page: Page): Promise<Record<string, string>> {
  return { "x-csrf-token": await getCsrfTokenFromContext(page.context()) };
}

/** A potential contract worth $25,000, opened in the browser. */
async function openContract(page: Page, name: string): Promise<string> {
  const headers = await headersFor(page);
  const res = await page.request.post(`${API}/projects`, { data: { name, potential: true }, headers });
  expect(res.ok()).toBe(true);
  const id: string = ((await res.json()) as { id: string }).id;
  const patch = await page.request.patch(`${API}/projects/${id}/pursuit`, { data: { valueCents: 2500000 }, headers });
  expect(patch.ok()).toBe(true);
  await page.goto(`${WEB}/dashboard/projects/${id}`);
  return id;
}

async function typeMoney(page: Page, label: string, amount: string): Promise<void> {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(amount);
  await field.blur();
}

test.describe("Contract cost and margin", () => {
  test("a typed cost shows profit and margin", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "cc-simple");
    await openContract(page, "Simple cost bid");
    await typeMoney(page, "Cost", "17000");
    await expect(page.getByTestId("profit-line")).toHaveText("Profit $8,000.00 · 32% margin", { timeout: 10000 });
    await context.close();
  });

  test("cost over value shows a loss", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "cc-loss");
    await openContract(page, "Loss bid");
    await typeMoney(page, "Cost", "30000");
    await expect(page.getByTestId("profit-line")).toContainText("-20% margin", { timeout: 10000 });
    await context.close();
  });

  test("breakdown: pick common costs or name your own, and the total replaces the typed cost", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "cc-details");
    await openContract(page, "Detailed bid");

    // The breakdown starts closed: one typed total is the default.
    await expect(page.getByText("+ Add a cost")).toBeHidden();
    await page.getByText("Break down cost").click();
    await expect(page.getByTestId("tracked-time-row")).toHaveCount(0);

    // A common one from the list.
    await page.getByRole("button", { name: "+ Add a cost" }).click();
    await page.getByLabel("New cost name").selectOption("Materials");
    await page.getByLabel("New cost amount").fill("5000");
    await page.getByLabel("New cost amount").press("Enter");
    await expect(page.getByLabel("Cost name").first()).toHaveValue("Materials", { timeout: 10000 });

    // Used ones drop out of the list; "Create my own" lets you type a name.
    await page.getByRole("button", { name: "+ Add a cost" }).click();
    await expect(page.getByLabel("New cost name").locator("option", { hasText: "Materials" })).toHaveCount(0);
    await page.getByLabel("New cost name").selectOption({ label: "Create my own…" });
    await page.getByLabel("New cost name").fill("Dumpster rental");
    await page.getByLabel("New cost amount").fill("450");
    await page.getByRole("button", { name: "Add cost" }).click();
    await expect(page.getByLabel("Cost name")).toHaveCount(2, { timeout: 10000 });

    // Escape closes the add row without adding.
    await page.getByRole("button", { name: "+ Add a cost" }).click();
    await page.getByLabel("New cost name").press("Escape");
    await expect(page.getByLabel("New cost name")).toHaveCount(0);

    // Cost is now the total of the breakdown, not typed.
    await expect(page.getByLabel("Cost", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("cost-total")).toHaveText("$5,450.00");
    await expect(page.getByTestId("breakdown-total")).toHaveText("$5,450.00");
    await expect(page.getByText("Cost (from breakdown)")).toBeVisible();
    await expect(page.getByTestId("profit-line")).toHaveText("Profit $19,550.00 · 78% margin");

    // Removing every line goes back to a typed cost.
    await page.getByRole("button", { name: "Remove Materials" }).click();
    await page.getByRole("button", { name: "Remove Dumpster rental" }).click();
    await expect(page.getByLabel("Cost", { exact: true })).toBeVisible({ timeout: 10000 });
    await context.close();
  });

  test("a contract with a cost per hour from before still shows tracked time", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "cc-legacy-rate");
    const id = await openContract(page, "Rate bid");
    const headers = await headersFor(page);
    // 1.5 hours logged yesterday, at $45 an hour.
    const end = new Date();
    end.setDate(end.getDate() - 1);
    end.setHours(12, 0, 0, 0);
    const start = new Date(end.getTime() - 90 * 60 * 1000);
    const entry = await page.request.post(`${API}/time-entries`, {
      data: { projectId: id, startedAt: start.toISOString(), endedAt: end.toISOString(), billable: false },
      headers,
    });
    expect(entry.ok()).toBe(true);
    const rate = await page.request.patch(`${API}/projects/${id}/costs`, { data: { laborRateCents: 4500 }, headers });
    expect(rate.ok()).toBe(true);
    await page.reload();

    const row = page.getByTestId("tracked-time-row");
    await expect(row).toContainText("1.5h ×", { timeout: 10000 });
    await expect(row).toContainText("$67.50");
    await page.getByRole("button", { name: "About tracked time" }).hover();
    await expect(page.getByRole("tooltip")).toContainText("not what you bill");

    // Clearing the rate removes the row.
    await typeMoney(page, "Cost per hour", "");
    await expect(row).toHaveCount(0, { timeout: 10000 });
    await context.close();
  });

  test("costs stay editable after a win and lock after a loss", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "cc-outcomes");
    const id = await openContract(page, "Outcome bid");
    const headers = await headersFor(page);

    // Won (straight through the API with a fresh contact).
    const contact = await page.request.post(`${API}/contacts`, {
      data: { firstName: "Wren", status: "lead" },
      headers,
    });
    expect(contact.ok()).toBe(true);
    const contactId: string = ((await contact.json()) as { id: string }).id;
    const won = await page.request.post(`${API}/projects/${id}/pursuit/win`, {
      data: { contactId, status: "in_progress", giveAccess: false },
      headers,
    });
    expect(won.ok()).toBe(true);
    await page.reload();
    // Won: the old deal fields are gone, and Value and Cost can still change.
    await expect(page.getByLabel("Next step", { exact: true })).toHaveCount(0);
    await typeMoney(page, "Value", "24000");
    await expect(page.getByTestId("deal-saved")).toHaveText("Saved", { timeout: 10000 });
    await page.reload();
    await expect(page.getByLabel("Value", { exact: true })).toHaveValue("24,000");
    await typeMoney(page, "Value", "25000");
    await expect(page.getByTestId("deal-saved")).toHaveText("Saved", { timeout: 10000 });
    await typeMoney(page, "Cost", "5000");
    await expect(page.getByTestId("profit-line")).toHaveText("Profit $20,000.00 · 80% margin", { timeout: 10000 });

    // A lost one is read-only.
    const lostId = await openContract(page, "Lost bid");
    const lose = await page.request.post(`${API}/projects/${lostId}/pursuit/lose`, { data: {}, headers });
    expect(lose.ok()).toBe(true);
    await page.reload();
    await expect(page.getByTestId("cost-total")).toBeVisible();
    await expect(page.getByLabel("Cost", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("deal-value")).toBeVisible();
    await context.close();
  });
});
