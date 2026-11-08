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
    await expect(page.getByTestId("profit-line")).toHaveText("Profit $8,000.00 · Margin 32%", { timeout: 10000 });
    await context.close();
  });

  test("cost over value shows a loss", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "cc-loss");
    await openContract(page, "Loss bid");
    await typeMoney(page, "Cost", "30000");
    await expect(page.getByTestId("profit-line")).toContainText("Margin -20%", { timeout: 10000 });
    await context.close();
  });

  test("details: tracked time at a cost rate plus a cost line", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "cc-details");
    const id = await openContract(page, "Detailed bid");
    // 1.5 hours logged yesterday.
    const end = new Date();
    end.setDate(end.getDate() - 1);
    end.setHours(12, 0, 0, 0);
    const start = new Date(end.getTime() - 90 * 60 * 1000);
    const entry = await page.request.post(`${API}/time-entries`, {
      data: { projectId: id, startedAt: start.toISOString(), endedAt: end.toISOString(), billable: false },
      headers: await headersFor(page),
    });
    expect(entry.ok()).toBe(true);
    await page.reload();

    await page.getByText("Cost details").click();
    await typeMoney(page, "Cost per hour", "45");
    await expect(page.getByTestId("labor-line")).toHaveText("Labor (tracked time) · 1.5h × $45.00 = $67.50", {
      timeout: 10000,
    });

    await page.getByLabel("New cost name").fill("Materials");
    await page.getByLabel("New cost amount").fill("5000");
    await page.getByRole("button", { name: "Add cost" }).click();
    await expect(page.getByLabel("Cost name").first()).toHaveValue("Materials", { timeout: 10000 });

    // Cost is now the total of the details, not typed.
    const cost = page.getByLabel("Cost", { exact: true });
    await expect(cost).toHaveValue("5,067.50");
    await expect(cost).toHaveAttribute("readonly", "");
    await expect(page.getByTestId("cost-from-details")).toBeVisible();
    await expect(page.getByTestId("profit-line")).toHaveText("Profit $19,932.50 · Margin 80%");

    // Removing the line and clearing the rate goes back to a typed cost.
    await page.getByRole("button", { name: "Remove Materials" }).click();
    await typeMoney(page, "Cost per hour", "");
    await expect(cost).not.toHaveAttribute("readonly", "", { timeout: 10000 });
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
    await expect(page.getByLabel("Value", { exact: true })).toBeDisabled();
    await typeMoney(page, "Cost", "5000");
    await expect(page.getByTestId("profit-line")).toHaveText("Profit $20,000.00 · Margin 80%", { timeout: 10000 });

    // A lost one is read-only.
    const lostId = await openContract(page, "Lost bid");
    const lose = await page.request.post(`${API}/projects/${lostId}/pursuit/lose`, { data: {}, headers });
    expect(lose.ok()).toBe(true);
    await page.reload();
    await expect(page.getByLabel("Cost", { exact: true })).toBeDisabled();
    await context.close();
  });
});
