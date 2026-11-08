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
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /Potential contract/ }).click();
    await expect(dialog.getByRole("heading", { name: "New potential contract" })).toBeVisible();
    await dialog.getByPlaceholder("County RFP: records system").fill("County RFP: records portal");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/?]+/, { timeout: 15000 });
    await expect(await stageButton(page, "Lead")).toHaveAttribute("aria-pressed", "true");
    // Opens on updates, like any project.
    await expect(page.getByTestId("project-tab-updates")).toHaveAttribute("aria-selected", "true");
    // A quiet note by the composer says clients can't see updates yet.
    await expect(page.getByTestId("updates-internal-note")).toHaveText("Internal: clients can't see this until it's won");
    // The rest of the composer agrees.
    await expect(page.getByPlaceholder("Write an update for your team…")).toBeVisible();
    await expect(page.getByText("Team only", { exact: true })).toBeVisible();
    await expect(page.getByText("Visible to client", { exact: true })).toHaveCount(0);
    // Pre-award: nothing for a client to see, so no preview.
    await expect(page.getByRole("button", { name: "View as client" })).toHaveCount(0);
    // Unsigned: no billing, no invoices.
    await expect(page.getByTestId("project-tab-invoices")).toHaveCount(0);
    await context.close();
  });

  test("creating from the projects page opens the new contract", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "pc-fromlist");
    await page.goto(`${WEB}/dashboard/projects?status=pursuit`);
    await page.getByRole("button", { name: /new project/i }).first().click();
    const dialog = page.getByRole("dialog", { name: "New potential contract" });
    await dialog.getByPlaceholder("County RFP: records system").fill("List-made bid");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/?]+/, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: "List-made bid" })).toBeVisible();
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
    await expect(page.getByTestId("deal-saved")).toHaveText("Saved");
    await expect(async () => {
      const res = await page.request.get(`${API}/projects/${id}`);
      expect(((await res.json()) as { pursuit: { valueCents: number } }).pursuit.valueCents).toBe(4500000);
    }).toPass({ timeout: 10000 });

    await page.goto(`${WEB}/dashboard/projects?status=pursuit`);
    const row = page.getByRole("link", { name: /Website redesign/ });
    await expect(row.getByTestId("pursuit-badge")).toHaveText("Proposal sent");
    // Clearly marked as not signed yet, not just by its stage.
    await expect(row.getByTestId("pursuit-tag")).toHaveText("Potential contract");
    await context.close();
  });

  test("a rejected deal field goes back to the saved value", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "pc-reject");
    const id = await createPotential(page, "Port bid");
    await page.goto(`${WEB}/dashboard/projects/${id}`);
    await page.getByText("Formal bid").click();
    const link = page.getByLabel("Posting link");
    await link.fill("not a link");
    await link.blur();
    await expect(link).toHaveValue("", { timeout: 10000 });
    await context.close();
  });

  test("typing a date with the keyboard saves the whole date", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "pc-datetype");
    const id = await createPotential(page, "Typed date bid");
    await page.goto(`${WEB}/dashboard/projects/${id}`);
    const close = page.getByLabel("Expected close");
    await close.click();
    await page.keyboard.type("12312026");
    await close.blur();
    await expect(close).toHaveValue("2026-12-31");
    await expect(async () => {
      const res = await page.request.get(`${API}/projects/${id}`);
      const closeDate: string | null = ((await res.json()) as { pursuit: { closeDate: string | null } }).pursuit.closeDate;
      expect(closeDate?.slice(0, 10)).toBe("2026-12-31");
    }).toPass({ timeout: 10000 });
    await context.close();
  });

  test("a lost deal offers Reopen, and an invoices link shows billing without invoices", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "pc-reopenlabel");
    const id = await createPotential(page, "Gone deal");
    const lose = await page.request.post(`${API}/projects/${id}/pursuit/lose`, { data: {}, headers: await headersFor(page) });
    expect(lose.ok()).toBe(true);
    await page.goto(`${WEB}/dashboard/projects/${id}?tab=invoices`);
    await expect(page.getByText("Lost", { exact: false }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Unarchive" })).toHaveCount(0);
    await expect(page.getByTestId("project-tab-billing")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Invoices" })).toHaveCount(0);
    // Named for what's there: just time until it's won.
    await expect(page.getByTestId("project-tab-billing")).toHaveText("Time");
    await expect(page.getByTestId("invoices-after-win")).toHaveText("Invoices open up once it's won.");
    await context.close();
  });

  test("the project page has four tabs and old tab links still land", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "pc-tabs");
    const id = await createPotential(page, "Tabs bid");
    await page.goto(`${WEB}/dashboard/projects/${id}`);
    await expect(page.getByRole("tab")).toHaveText(["Updates", "Files", "Time", "Internal"]);
    // Tasks live on Updates, between the composer and the timeline.
    await expect(page.getByRole("heading", { name: /^Tasks/ })).toBeVisible();
    await page.goto(`${WEB}/dashboard/projects/${id}?tab=tasks`);
    await expect(page.getByTestId("project-tab-updates")).toHaveAttribute("aria-selected", "true");
    // Notes are part of Internal.
    await page.goto(`${WEB}/dashboard/projects/${id}?tab=notes`);
    await expect(page.getByTestId("project-tab-internal")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByPlaceholder("Write an internal note...")).toBeVisible();
    await context.close();
  });

  test("won dialog picks a status when statuses load after it opens", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "pc-slowstatus");
    const id = await createPotential(page, "Slow bid");
    let release: () => void = () => {};
    const gate: Promise<void> = new Promise((r) => (release = r));
    await page.route("**/api/projects/statuses", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(`${WEB}/dashboard/projects/${id}`);
    await page.getByRole("button", { name: "Won" }).click();
    release();
    await expect(page.getByRole("dialog").locator("#won-status")).toHaveValue("in_progress", { timeout: 10000 });
    // A new person typed here is the client, not a lead.
    await page.getByRole("dialog").getByPlaceholder("Search or type a new name").fill("Ana Ruiz");
    await page.getByRole("dialog").getByRole("button", { name: /Create .Ana Ruiz./ }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Add client" })).toBeVisible();
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
    await expect(card).toContainText("Pipeline value");

    const stats = await (await page.request.get(`${API}/projects/stats`)).json();
    expect(stats.total).toBe(0);
    await context.close();
  });

  test("pipeline card says how late an overdue step is", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "pc-late");
    const id = await createPotential(page, "Late bid");
    const patch = await page.request.patch(`${API}/projects/${id}/pursuit`, {
      data: { nextStep: "Send pricing", nextStepAt: inDays(-2) },
      headers: await headersFor(page),
    });
    expect(patch.ok()).toBe(true);
    await page.goto(`${WEB}/dashboard`);
    await expect(page.getByTestId("pipeline-card")).toContainText("2 days late", { timeout: 15000 });
    await context.close();
  });

  test("lost archives it and reopen brings it back", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "pc-lost");
    const id = await createPotential(page, "Long shot");
    await page.goto(`${WEB}/dashboard/projects/${id}`);

    await page.getByRole("button", { name: "Lost", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Show archived & cancelled");
    await page.getByLabel("Reason (optional)").fill("Price");
    await page.getByRole("button", { name: "Mark lost" }).click();
    await expect(page.getByText("Lost · Price")).toBeVisible({ timeout: 10000 });
    // Read-only now: empty fields show a dash, not example text.
    await expect(page.getByLabel("Value")).toHaveAttribute("placeholder", "—");
    await expect(page.getByLabel("Next step", { exact: true })).toHaveAttribute("placeholder", "—");

    const active = await (await page.request.get(`${API}/projects`)).json();
    expect(active.data.map((p: { id: string }) => p.id)).not.toContain(id);
    // Still findable: Potential contracts with archived on lists lost ones too.
    const openOnly = await (await page.request.get(`${API}/projects?pursuit=only`)).json();
    expect(openOnly.data.map((p: { id: string }) => p.id)).not.toContain(id);
    const withLost = await (await page.request.get(`${API}/projects?pursuit=only&archived=true`)).json();
    expect(withLost.data.map((p: { id: string }) => p.id)).toContain(id);

    await page.getByRole("button", { name: "Reopen" }).first().click();
    await expect(await stageButton(page, "Lead")).toHaveAttribute("aria-pressed", "true", { timeout: 10000 });
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
    // Right after the win, a prompt points at what's still internal.
    const banner = env.owner.getByTestId("won-internal-banner");
    await expect(banner).toContainText("1 item from before the win is still internal");
    await expect(env.owner.getByTestId("updates-internal-note")).toHaveCount(0);
    // Won: billing is back in the tab name.
    await expect(env.owner.getByTestId("project-tab-billing")).toHaveText("Time & billing");

    // The client gets the project, but not what was written before the win.
    await env.client.goto(`${WEB}/portal/projects/${id}`);
    await expect(env.client.getByRole("heading", { name: "Museum kiosk", exact: true })).toBeVisible({ timeout: 15000 });
    await expect(env.client.getByText("Our margin on this is thin")).toHaveCount(0);

    // Shared from the Internal tab, it shows up. Review on the prompt opens that tab.
    await banner.getByRole("button", { name: "Review" }).click();
    await expect(env.owner.getByTestId("project-tab-internal")).toHaveAttribute("aria-selected", "true");
    // What Review points at is first on the tab, not under the notes.
    await expect(env.owner.getByTestId("pre-win-items")).toBeInViewport();
    // One Clients heading on a signed project.
    await expect(env.owner.getByRole("heading", { name: /^Clients/ })).toHaveCount(1);
    await env.owner.getByRole("button", { name: /^Share .* with client$/ }).first().click();
    // It asks first, since this was written for the team only.
    const confirm = env.owner.getByRole("dialog");
    await expect(confirm).toContainText("written for your team");
    await confirm.getByRole("button", { name: "Share", exact: true }).click();
    await expect(env.owner.getByTestId("pre-win-items")).toHaveCount(0, { timeout: 10000 });

    await env.client.reload();
    await expect(env.client.getByText("Our margin on this is thin")).toBeVisible({ timeout: 15000 });
    await env.close();
  });

  test("won with access off gives the client nothing", async ({ browser }) => {
    const env = await createPortalClientProject(browser, "pc-noaccess", "Signed site");
    const id = await createPotential(env.owner, "Quiet win");
    const contactId = await contactIdByEmail(env.owner, env.clientEmail);
    await env.owner.request.post(`${API}/contacts/${contactId}/projects/${id}`, { headers: env.ownerHeaders });

    await env.owner.goto(`${WEB}/dashboard/projects/${id}`);
    await env.owner.getByRole("button", { name: "Won" }).click();
    const dialog = env.owner.getByRole("dialog");
    await expect(dialog.getByLabel(/Give portal access now/)).not.toBeChecked();
    await expect(dialog).toContainText("They'll see this project in their portal");
    await dialog.getByRole("button", { name: "Mark won" }).click();
    await expect(env.owner.getByRole("dialog")).toHaveCount(0, { timeout: 10000 });

    const res = await env.client.request.get(`${API}/projects/mine/${id}`);
    expect(res.status()).toBe(404);
    await env.close();
  });

  test("link a new lead from the contacts card, win with an invite, and the invite gives the project", async ({
    browser,
  }) => {
    const { context, page } = await createOwner(browser, "pc-invite");
    const id = await createPotential(page, "Clinic rebuild");
    const email = `pc-lead-${Date.now()}@test.local`;

    // Link a brand-new lead from the Contacts card; linking doesn't invite them.
    await page.goto(`${WEB}/dashboard/projects/${id}`);
    await page.getByRole("button", { name: "+ Contact" }).click();
    const linkDialog = page.getByRole("dialog", { name: "Link a contact" });
    await linkDialog.getByPlaceholder("Search or type a new name").fill("Lee Park");
    await linkDialog.getByRole("button", { name: /Create .Lee Park./ }).click();
    await linkDialog.getByPlaceholder("Email (optional)").fill(email);
    await linkDialog.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByRole("link", { name: "Lee Park" })).toBeVisible({ timeout: 10000 });
    const before = await (await page.request.get(`${API}/clients/invitations`)).json();
    expect(before.find((i: { email: string }) => i.email === email)).toBeFalsy();

    // Win with "Invite to the portal now".
    await page.getByRole("button", { name: "Won" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Invite to the portal now/).check();
    await dialog.getByRole("button", { name: "Mark won" }).click();
    await expect(page.getByText(`Portal invite sent to ${email}`)).toBeVisible({ timeout: 15000 });

    const invitations = await (await page.request.get(`${API}/clients/invitations`)).json();
    const invite = invitations.find((i: { email: string }) => i.email === email);
    expect(invite).toBeTruthy();

    // Accepting the invite gives them this project.
    const clientCtx = await browser.newContext({ storageState: undefined });
    const clientPage = await clientCtx.newPage();
    await clientPage.goto(invite.inviteLink);
    await clientPage.getByRole("button", { name: /use a password instead/i }).click();
    await clientPage.locator("#name").fill("Lee Park");
    await clientPage.locator("#email").fill(email);
    await clientPage.locator("#password").fill("Client123!");
    await clientPage.getByRole("button", { name: /create account & join/i }).click();
    await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });
    await clientPage.goto(`${WEB}/portal/projects`);
    await expect(clientPage.getByText("Clinic rebuild")).toBeVisible({ timeout: 15000 });
    await clientCtx.close();
    await context.close();
  });
});
