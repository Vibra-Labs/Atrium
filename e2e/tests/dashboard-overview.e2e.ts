import { test, expect } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { createOwner, getCsrfTokenFromContext, inviteAndAcceptClient } from "./helpers";

const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";

/** A date key `days` from today in the browser's (and this machine's) timezone. */
function dayFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function loginClient(browser: Browser, email: string, password: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: undefined });
  const page = await ctx.newPage();
  await page.goto(`${WEB_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/portal/, { timeout: 15000 });
  return { ctx, page };
}

// A fresh workspace, so other tests' projects and invoices can't crowd these widgets.
test.describe.serial("Dashboard overview", () => {
  test.setTimeout(120000);

  let ownerCtx: BrowserContext;
  let owner: Page;
  let clientCtx: BrowserContext;
  let client: Page;
  let activeProject: { id: string; name: string };
  let doneProject: { id: string; name: string };
  const stamp: number = Date.now();

  test.beforeAll(async ({ browser }) => {
    ({ context: ownerCtx, page: owner } = await createOwner(browser, "dash-owner"));
    const { clientEmail, password } = await inviteAndAcceptClient(browser, owner, "dash-client");
    const clients = await (await owner.request.get(`${API_URL}/api/clients?limit=100`)).json();
    const clientRow = (clients.data ?? clients).find(
      (m: { user: { email: string } }) => m.user.email === clientEmail,
    );
    const headers = { "x-csrf-token": await getCsrfTokenFromContext(ownerCtx) };

    activeProject = await (await owner.request.post(`${API_URL}/api/projects`, {
      data: { name: `Active ${stamp}`, clientUserIds: [clientRow.userId] },
      headers,
    })).json();
    doneProject = await (await owner.request.post(`${API_URL}/api/projects`, {
      data: { name: `Done ${stamp}` },
      headers,
    })).json();
    const done = await owner.request.put(`${API_URL}/api/projects/${doneProject.id}`, {
      data: { status: "completed" },
      headers,
    });
    expect(done.ok()).toBe(true);

    ({ ctx: clientCtx, page: client } = await loginClient(browser, clientEmail, password));
  });

  test.afterAll(async () => {
    await clientCtx?.close();
    await ownerCtx?.close();
  });

  test("activity endpoint is for owners and admins, with a capped limit", async () => {
    const res = await owner.request.get(`${API_URL}/api/activity?limit=500`);
    expect(res.ok()).toBe(true);
    const items: unknown[] = await res.json();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeLessThanOrEqual(50);

    const asClient = await client.request.get(`${API_URL}/api/activity`);
    expect(asClient.status()).toBe(403);
  });

  test("a client's vote shows up in the dashboard's client activity", async () => {
    const headers = { "x-csrf-token": await getCsrfTokenFromContext(ownerCtx) };
    // A vote is logged under the decision's question.
    const question = `Which palette? ${stamp}`;
    const task = await (await owner.request.post(`${API_URL}/api/tasks?projectId=${activeProject.id}`, {
      data: { title: "Pick a palette", type: "decision", question, options: [{ label: "Warm" }, { label: "Cool" }] },
      headers,
    })).json();

    const vote = await client.request.post(`${API_URL}/api/tasks/${task.id}/vote`, {
      data: { optionId: task.options[0].id },
      headers: { "x-csrf-token": await getCsrfTokenFromContext(clientCtx) },
    });
    expect(vote.ok()).toBe(true);

    // The activity row is written in the background after the vote returns.
    await expect
      .poll(async () => {
        const items: { targetTitle: string; project: { name: string } | null }[] =
          await (await owner.request.get(`${API_URL}/api/activity`)).json();
        return items.find((i) => i.targetTitle === question)?.project?.name;
      })
      .toBe(activeProject.name);

    await owner.goto(`${WEB_URL}/dashboard`);
    const card = owner.locator("section", { has: owner.getByRole("heading", { name: "Client activity" }) });
    await expect(card.getByText(question)).toBeVisible({ timeout: 15000 });
  });

  test("an overdue invoice built from line items shows its real total", async () => {
    const headers = { "x-csrf-token": await getCsrfTokenFromContext(ownerCtx) };
    const invoice = await (await owner.request.post(`${API_URL}/api/invoices`, {
      data: {
        projectId: activeProject.id,
        lineItems: [{ description: "Design sprint", quantity: 3, unitPrice: 5000 }],
      },
      headers,
    })).json();
    for (const status of ["sent", "overdue"]) {
      const res = await owner.request.put(`${API_URL}/api/invoices/${invoice.id}`, { data: { status }, headers });
      expect(res.ok(), await res.text()).toBe(true);
    }

    await owner.goto(`${WEB_URL}/dashboard`);
    const row = owner.locator("#overdue-invoices > div", { hasText: `${invoice.invoiceNumber} is overdue` });
    await expect(row).toContainText("$150.00", { timeout: 15000 });
    await expect(owner.getByTestId("outstanding-card")).toContainText("1 overdue");
  });

  test("this week lists a task due in the next few days", async () => {
    const headers = { "x-csrf-token": await getCsrfTokenFromContext(ownerCtx) };
    const title = `Send homepage copy ${stamp}`;
    const res = await owner.request.post(`${API_URL}/api/tasks?projectId=${activeProject.id}`, {
      data: { title, dueDate: dayFromNow(2) },
      headers,
    });
    expect(res.ok(), await res.text()).toBe(true);

    await owner.goto(`${WEB_URL}/dashboard`);
    const card = owner.locator("section", { has: owner.getByRole("heading", { name: "This week" }) });
    await expect(card.getByRole("link", { name: title })).toBeVisible({ timeout: 15000 });
    await expect(card).toContainText("Task due");
  });

  test("the Completed widget opens the project list filtered to completed, and the filter clears", async () => {
    await owner.goto(`${WEB_URL}/dashboard`);
    await owner.getByRole("link", { name: /^Completed/ }).click();
    await owner.waitForURL(/\/dashboard\/projects\?status=completed$/);

    const statusSelect = owner.locator("select").filter({ has: owner.locator('option[value="completed"]') }).first();
    await expect(statusSelect).toHaveValue("completed");
    await expect(owner.getByText(doneProject.name).first()).toBeVisible({ timeout: 15000 });
    await expect(owner.getByText(activeProject.name)).toHaveCount(0);

    await owner.goto(`${WEB_URL}/dashboard/projects`);
    await expect(statusSelect).toHaveValue("");
    await expect(owner.getByText(activeProject.name).first()).toBeVisible({ timeout: 15000 });
  });

  test("the sidebar profile link opens account settings", async () => {
    await owner.goto(`${WEB_URL}/dashboard`);
    await owner.getByTitle("Account settings").click();
    await owner.waitForURL(/\/dashboard\/settings\/account$/);
    await expect(owner.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Account" })).toBeVisible();
  });
});
