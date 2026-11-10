import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { createOwner, createPortalClientProject, getCsrfTokenFromContext } from "./helpers";

const API = "http://localhost:3001/api";
const WEB = "http://localhost:3000";

interface Stage {
  id: string;
  pipeline: string;
  name: string;
  slug: string;
}

async function headersFor(page: Page): Promise<Record<string, string>> {
  return { "x-csrf-token": await getCsrfTokenFromContext(page.context()) };
}

async function createPotential(page: Page, name: string): Promise<string> {
  const res = await page.request.post(`${API}/projects`, {
    data: { name, potential: true },
    headers: await headersFor(page),
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

async function addStage(page: Page, pipeline: string, name: string): Promise<void> {
  const res = await page.request.post(`${API}/pursuit-stages`, {
    data: { pipeline, name },
    headers: await headersFor(page),
  });
  expect(res.ok()).toBe(true);
}

async function setStage(page: Page, projectId: string, stage: string): Promise<void> {
  const res = await page.request.patch(`${API}/projects/${projectId}/pursuit`, {
    data: { stage },
    headers: await headersFor(page),
  });
  expect(res.ok()).toBe(true);
}

function section(page: Page): Locator {
  return page.locator("section", { has: page.getByRole("heading", { name: "Pipeline stages" }) });
}

function stageButtons(page: Page): Locator {
  return page.getByTestId("pursuit-stage");
}

async function openSettings(page: Page, pipeline: "Bids" | "Commercial" = "Commercial"): Promise<Locator> {
  await page.goto(`${WEB}/dashboard/settings/workspace`);
  const s = section(page);
  await s.getByRole("tab", { name: pipeline }).click();
  await expect(s.getByTestId("pipeline-stage-row").first()).toBeVisible({ timeout: 15000 });
  return s;
}

test.describe("Pipeline stages", () => {
  test("a new workspace has the three default stages in both pipelines", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "ps-defaults");
    // Each row also holds its Rename / Remove buttons.
    const defaults = [/^Lead/, /^Proposal sent/, /^Waiting on decision/];

    const s = await openSettings(page);
    await expect(s.getByTestId("pipeline-stage-row")).toHaveText(defaults);
    await s.getByRole("tab", { name: "Bids" }).click();
    await expect(s.getByTestId("pipeline-stage-row")).toHaveText(defaults);
    await context.close();
  });

  test("an added commercial stage shows on a contract and can be selected", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "ps-add");
    const s = await openSettings(page);
    await s.getByLabel("New stage").fill("Verbal yes");
    await s.getByRole("button", { name: "Add" }).click();
    await expect(s.getByTestId("pipeline-stage-row")).toHaveCount(4);

    const id = await createPotential(page, "Retail fit-out");
    await page.goto(`${WEB}/dashboard/projects/${id}`);
    const verbal = stageButtons(page).filter({ hasText: "Verbal yes" });
    await verbal.click();
    await expect(verbal).toHaveAttribute("aria-pressed", "true");

    await page.goto(`${WEB}/dashboard/projects?status=pursuit`);
    const row = page.getByRole("link", { name: /Retail fit-out/ });
    await expect(row.getByTestId("pursuit-badge")).toHaveText("Verbal yes");
    await context.close();
  });

  test("a bid contract shows the bid stages", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "ps-bid");
    await addStage(page, "bid", "Questions submitted");
    await addStage(page, "commercial", "Verbal yes");
    const id = await createPotential(page, "County RFP");
    await page.goto(`${WEB}/dashboard/projects/${id}`);
    await expect(stageButtons(page).filter({ hasText: "Verbal yes" })).toBeVisible();

    // The box follows the saved contract, so it flips once the save comes back.
    await page.getByLabel("Formal bid").click();
    await expect(page.getByLabel("Formal bid")).toBeChecked();
    await expect(stageButtons(page).filter({ hasText: "Questions submitted" })).toBeVisible();
    await expect(stageButtons(page).filter({ hasText: "Verbal yes" })).toHaveCount(0);
    // "Lead" exists in both pipelines, so the contract stays in it.
    await expect(stageButtons(page).filter({ hasText: "Lead" })).toHaveAttribute("aria-pressed", "true");
    await context.close();
  });

  test("renaming a stage updates contracts already in it", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "ps-rename");
    const id = await createPotential(page, "Office move");
    await setStage(page, id, "proposal_sent");

    const s = await openSettings(page);
    await s.getByRole("button", { name: "Rename Proposal sent" }).click();
    const input = s.getByRole("textbox", { name: "Rename Proposal sent" });
    await input.fill("Quote sent");
    await input.press("Enter");
    await expect(s.getByTestId("pipeline-stage-row").nth(1)).toHaveText(/Quote sent/);

    await page.goto(`${WEB}/dashboard/projects/${id}`);
    await expect(stageButtons(page).filter({ hasText: "Quote sent" })).toHaveAttribute("aria-pressed", "true");
    await context.close();
  });

  test("reordering changes the stage bar order", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "ps-order");
    const s = await openSettings(page);
    await s.getByRole("button", { name: "Move Waiting on decision up" }).click();
    await expect(s.getByTestId("pipeline-stage-row").nth(1)).toHaveText(/Waiting on decision/);
    await s.getByRole("button", { name: "Move Waiting on decision up" }).click();
    await expect(s.getByTestId("pipeline-stage-row").first()).toHaveText(/Waiting on decision/);

    const id = await createPotential(page, "Warehouse lighting");
    await page.goto(`${WEB}/dashboard/projects/${id}`);
    await expect(stageButtons(page)).toHaveText(["Waiting on decision", "Lead", "Proposal sent"]);
    // New contracts start in the first stage.
    await expect(stageButtons(page).first()).toHaveAttribute("aria-pressed", "true");
    await context.close();
  });

  test("removing a stage moves its contracts", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "ps-remove");
    const id = await createPotential(page, "Clinic signage");
    await setStage(page, id, "waiting");

    const s = await openSettings(page);
    await s.getByRole("button", { name: "Remove Waiting on decision" }).click();
    await s.getByLabel("Move its contracts to").selectOption({ label: "Proposal sent" });
    await s.getByRole("button", { name: "Remove stage" }).click();
    await expect(s.getByTestId("pipeline-stage-row")).toHaveCount(2);

    await page.goto(`${WEB}/dashboard/projects/${id}`);
    await expect(stageButtons(page)).toHaveText(["Lead", "Proposal sent"]);
    await expect(stageButtons(page).filter({ hasText: "Proposal sent" })).toHaveAttribute("aria-pressed", "true");

    const stages = (await (await page.request.get(`${API}/pursuit-stages`)).json()) as Stage[];
    // The Bids pipeline is untouched.
    expect(stages.filter((st) => st.pipeline === "bid").map((st) => st.name)).toEqual([
      "Lead",
      "Proposal sent",
      "Waiting on decision",
    ]);
    await context.close();
  });

  test("a portal client can't read stages", async ({ browser }) => {
    const env = await createPortalClientProject(browser, "ps-client", "Signed site");
    const res = await env.client.request.get(`${API}/pursuit-stages`);
    expect(res.status()).toBe(403);
    await env.close();
  });
});
