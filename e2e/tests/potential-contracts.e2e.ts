import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  contactIdByEmail,
  createOwner,
  createPortalClientProject,
  getCsrfTokenFromContext,
} from "./helpers";

const API = "http://localhost:3001/api";
const WEB = "http://localhost:3000";

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function headersFor(page: Page): Promise<Record<string, string>> {
  return { "x-csrf-token": await getCsrfTokenFromContext(page.context()) };
}

/** Creates a potential contract through the API and returns its id. */
async function createPotential(page: Page, name: string): Promise<string> {
  const res = await page.request.post(`${API}/projects`, {
    data: { name, potential: true },
    headers: await headersFor(page),
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

async function stageButton(page: Page, label: string) {
  return page.getByTestId("pursuit-stage").filter({ hasText: label });
}

test.describe("Potential contracts", () => {
  test("create a potential contract from the dashboard pop-up", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "pc-create");
    await page.goto(`${WEB}/dashboard`);
    await page.getByRole("button", { name: "New Project" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await dialog.getByRole("button", { name: /Potential contract/ }).click();
    await dialog.getByPlaceholder("County RFP: records system").fill("County RFP: records portal");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/?]+/, { timeout: 15000 });
    await expect(await stageButton(page, "Found")).toHaveAttribute("aria-pressed", "true");
    // Unsigned: no billing, no invoices.
    await expect(page.getByTestId("project-tab-invoices")).toHaveCount(0);
    await context.close();
  });

  test("move stage and set value", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "pc-stage");
    const id = await createPotential(page, "Website redesign");
    await page.goto(`${WEB}/dashboard/projects/${id}`);

    await (await stageButton(page, "Proposal sent")).click();
    await expect(await stageButton(page, "Proposal sent")).toHaveAttribute("aria-pressed", "true");

    const value = page.getByLabel("Value");
    await value.fill("45000");
    await expect(value).toHaveValue("45,000");
    await value.blur();
    await expect(async () => {
      const res = await page.request.get(`${API}/projects/${id}`);
      expect(((await res.json()) as { pursuit: { valueCents: number } }).pursuit.valueCents).toBe(4500000);
    }).toPass({ timeout: 10000 });

    await page.goto(`${WEB}/dashboard/projects?status=pursuit`);
    const row = page.getByRole("link", { name: /Website redesign/ });
    await expect(row.getByTestId("pursuit-badge")).toHaveText("Proposal sent");
    await context.close();
  });

  test("pipeline card shows the open contract and it stays out of active projects", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "pc-pipeline");
    const id = await createPotential(page, "Harbor bid");
    const patch = await page.request.patch(`${API}/projects/${id}/pursuit`, {
      data: { valueCents: 1200000, nextStep: "Call the buyer", nextStepAt: inDays(2) },
      headers: await headersFor(page),
    });
    expect(patch.ok()).toBe(true);

    await page.goto(`${WEB}/dashboard`);
    const card = page.getByTestId("pipeline-card");
    await expect(card).toContainText("Call the buyer");
    await expect(card).toContainText("1 contract");

    const stats = await (await page.request.get(`${API}/projects/stats`)).json();
    expect(stats.total).toBe(0);
    await context.close();
  });

  test("lost archives it and reopen brings it back", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "pc-lost");
    const id = await createPotential(page, "Long shot");
    await page.goto(`${WEB}/dashboard/projects/${id}`);

    await page.getByRole("button", { name: "Lost", exact: true }).click();
    await page.getByLabel("Reason (optional)").fill("Price");
    await page.getByRole("button", { name: "Mark lost" }).click();
    await expect(page.getByText("Lost · Price")).toBeVisible({ timeout: 10000 });

    const active = await (await page.request.get(`${API}/projects`)).json();
    expect(active.data.map((p: { id: string }) => p.id)).not.toContain(id);

    await page.getByRole("button", { name: "Reopen" }).first().click();
    await expect(await stageButton(page, "Found")).toHaveAttribute("aria-pressed", "true", { timeout: 10000 });
    await context.close();
  });

  test("client never sees an open potential contract", async ({ browser }) => {
    const env = await createPortalClientProject(browser, "pc-hidden", "Signed site");
    const id = await createPotential(env.owner, "Secret bid");

    await env.client.goto(`${WEB}/portal/projects`);
    await expect(env.client.getByText("Signed site")).toBeVisible({ timeout: 15000 });
    await expect(env.client.getByText("Secret bid")).toHaveCount(0);
    const res = await env.client.request.get(`${API}/projects/mine/${id}`);
    expect(res.status()).toBe(404);
    await env.close();
  });

  test("won with an existing portal client keeps earlier work internal until shared", async ({ browser }) => {
    const env = await createPortalClientProject(browser, "pc-won", "Signed site");
    const id = await createPotential(env.owner, "Museum kiosk");
    const headers = env.ownerHeaders;

    // Written while chasing it.
    const update = await env.owner.request.post(`${API}/updates?projectId=${id}`, {
      data: { content: "Our margin on this is thin" },
      headers,
    });
    expect(update.ok()).toBe(true);
    const contactId = await contactIdByEmail(env.owner, env.clientEmail);
    const link = await env.owner.request.post(`${API}/contacts/${contactId}/projects/${id}`, { headers });
    expect(link.ok()).toBe(true);

    await env.owner.goto(`${WEB}/dashboard/projects/${id}`);
    await env.owner.getByRole("button", { name: "Won" }).click();
    const dialog = env.owner.getByRole("dialog");
    await dialog.getByLabel(/Give portal access now/).check();
    await dialog.getByRole("button", { name: "Mark won" }).click();
    await expect(env.owner.getByTestId("project-tab-internal")).toBeVisible({ timeout: 15000 });

    // The client gets the project, but not what was written before the win.
    await env.client.goto(`${WEB}/portal/projects/${id}`);
    await expect(env.client.getByRole("heading", { name: "Museum kiosk", exact: true })).toBeVisible({ timeout: 15000 });
    await expect(env.client.getByText("Our margin on this is thin")).toHaveCount(0);

    // Shared from the Internal tab, it shows up.
    await env.owner.getByTestId("project-tab-internal").click();
    await env.owner.getByRole("button", { name: "Share with client" }).first().click();
    await expect(env.owner.getByTestId("project-tab-internal")).toHaveCount(0, { timeout: 10000 });

    await env.client.reload();
    await expect(env.client.getByText("Our margin on this is thin")).toBeVisible({ timeout: 15000 });
    await env.close();
  });
});
