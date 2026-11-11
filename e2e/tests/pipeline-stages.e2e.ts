import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { createOwner, createPortalClientProject, getCsrfTokenFromContext } from "./helpers";

const API = "http://localhost:3001/api";
const WEB = "http://localhost:3000";

interface Pipeline {
  id: string;
  name: string;
  stages: { id: string; name: string; slug: string }[];
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

async function pipelines(page: Page): Promise<Pipeline[]> {
  const res = await page.request.get(`${API}/pursuit-pipelines`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as Pipeline[];
}

async function addStage(page: Page, pipelineName: string, name: string): Promise<void> {
  const pipelineId = (await pipelines(page)).find((p) => p.name === pipelineName)!.id;
  const res = await page.request.post(`${API}/pursuit-stages`, {
    data: { pipelineId, name },
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
  return page.locator("section", { has: page.getByRole("heading", { name: "Pipelines", exact: true }) });
}

function stageButtons(page: Page): Locator {
  return page.getByTestId("pursuit-stage");
}

async function openSettings(page: Page): Promise<Locator> {
  await page.goto(`${WEB}/dashboard/settings/workspace`);
  const s = section(page);
  await expect(steps(s).first()).toBeVisible({ timeout: 15000 });
  return s;
}

function steps(s: Locator): Locator {
  return s.getByTestId("pipeline-stage-step");
}

/** Clicks a stage to open its menu and picks an item. */
async function stageAction(s: Locator, stage: string, item: string): Promise<void> {
  const step = steps(s).filter({ hasText: stage });
  await step.click();
  await expect(step).toHaveAttribute("aria-pressed", "true");
  await s.getByRole("menuitem", { name: item }).click();
}

test.describe("Pipelines and stages", () => {
  test("a new workspace has Commercial and Bids, each with the three default stages", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "ps-defaults");
    const defaults = ["Lead", "Proposal sent", "Waiting on decision"];

    const s = await openSettings(page);
    await expect(s.getByRole("tab")).toHaveText(["Commercial", "Bids"]);
    await expect(s.getByRole("tab", { name: "Commercial" })).toHaveAttribute("aria-selected", "true");
    await expect(steps(s)).toHaveText(defaults);
    await s.getByRole("tab", { name: "Bids" }).click();
    await expect(steps(s)).toHaveText(defaults);
    await context.close();
  });

  test("an added commercial stage shows on a contract and can be selected", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "ps-add");
    const s = await openSettings(page);
    await s.getByRole("button", { name: "Add a stage" }).click();
    await s.getByLabel("New stage").fill("Verbal yes");
    await s.getByRole("button", { name: "Add", exact: true }).click();
    await expect(steps(s)).toHaveText(["Lead", "Proposal sent", "Waiting on decision", "Verbal yes"]);

    const id = await createPotential(page, "Retail fit-out");
    await page.goto(`${WEB}/dashboard/projects/${id}`);
    const verbal = stageButtons(page).filter({ hasText: "Verbal yes" });
    await verbal.click();
    await expect(verbal).toHaveAttribute("aria-pressed", "true");
    // The tracker fills in the stages before it.
    await expect(stageButtons(page).first()).toHaveAttribute("data-state", "done");

    await page.goto(`${WEB}/dashboard/projects?status=pursuit`);
    const row = page.getByRole("link", { name: /Retail fit-out/ });
    await expect(row.getByTestId("pursuit-badge")).toHaveText("Verbal yes");
    await context.close();
  });

  test("a contract's Pipeline dropdown switches its stages; the bid box doesn't", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "ps-bid");
    await addStage(page, "Bids", "Questions submitted");
    await addStage(page, "Commercial", "Verbal yes");
    const id = await createPotential(page, "County RFP");
    await page.goto(`${WEB}/dashboard/projects/${id}`);
    await expect(stageButtons(page).filter({ hasText: "Verbal yes" })).toBeVisible();

    // The box follows the saved contract, so it flips once the save comes back.
    await page.getByLabel("Formal bid").click();
    await expect(page.getByLabel("Formal bid")).toBeChecked();
    await expect(stageButtons(page).filter({ hasText: "Verbal yes" })).toBeVisible();

    await page.getByLabel("Pipeline").selectOption({ label: "Bids" });
    await expect(stageButtons(page).filter({ hasText: "Questions submitted" })).toBeVisible();
    await expect(stageButtons(page).filter({ hasText: "Verbal yes" })).toHaveCount(0);
    // "Lead" exists in both pipelines, so the contract stays in it.
    await expect(stageButtons(page).filter({ hasText: "Lead" })).toHaveAttribute("aria-pressed", "true");
    await context.close();
  });

  test("create, rename and delete a pipeline; its contracts move", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "ps-pipes");
    const s = await openSettings(page);
    await s.getByRole("button", { name: "New pipeline" }).click();
    await s.getByLabel("New pipeline").fill("Government");
    await s.getByRole("button", { name: "Add", exact: true }).click();
    await expect(s.getByRole("tab")).toHaveText(["Commercial", "Bids", "Government"]);
    await expect(s.getByRole("tab", { name: "Government" })).toHaveAttribute("aria-selected", "true");
    await expect(steps(s)).toHaveText(["Lead", "Proposal sent", "Waiting on decision"]);

    // Clicking the selected pipeline opens its menu.
    await s.getByRole("tab", { name: "Government" }).click();
    await s.getByRole("menuitem", { name: "Rename" }).click();
    const input = s.getByRole("textbox", { name: "Rename Government" });
    await input.fill("Federal");
    await input.press("Enter");
    await expect(s.getByRole("tab", { name: "Federal" })).toBeVisible();

    const id = await createPotential(page, "Base housing");
    const federal = (await pipelines(page)).find((p) => p.name === "Federal")!.id;
    const moved = await page.request.patch(`${API}/projects/${id}/pursuit`, {
      data: { pipelineId: federal, stage: "waiting" },
      headers: await headersFor(page),
    });
    expect(moved.ok()).toBe(true);

    await s.getByRole("tab", { name: "Federal" }).click();
    await s.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: /Delete .Federal/ });
    await dialog.getByLabel("Move its contracts to").selectOption({ label: "Bids" });
    await dialog.getByRole("button", { name: "Delete pipeline" }).click();
    await expect(s.getByRole("tab")).toHaveText(["Commercial", "Bids"]);

    await page.goto(`${WEB}/dashboard/projects/${id}`);
    await expect(page.getByLabel("Pipeline")).toHaveValue((await pipelines(page)).find((p) => p.name === "Bids")!.id);
    await expect(stageButtons(page).filter({ hasText: "Waiting on decision" })).toHaveAttribute("aria-pressed", "true");
    await context.close();
  });

  test("clicking a stage opens its menu, and clicking away closes it", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "ps-menu");
    const s = await openSettings(page);
    await steps(s).filter({ hasText: "Lead" }).click();
    await expect(s.getByRole("menu", { name: "Lead actions" })).toBeVisible();
    // The first stage can't move earlier.
    await expect(s.getByRole("menuitem", { name: "Move earlier" })).toBeDisabled();
    await page.getByRole("heading", { name: "Pipelines", exact: true }).click();
    await expect(s.getByRole("menu")).toHaveCount(0);
    await expect(steps(s).first()).toHaveAttribute("aria-pressed", "false");
    await context.close();
  });

  test("renaming a stage updates contracts already in it", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "ps-rename");
    const id = await createPotential(page, "Office move");
    await setStage(page, id, "proposal_sent");

    const s = await openSettings(page);
    await stageAction(s, "Proposal sent", "Rename");
    const input = s.getByRole("textbox", { name: "Rename Proposal sent" });
    await input.fill("Quote sent");
    await input.press("Enter");
    await expect(steps(s).nth(1)).toHaveText("Quote sent");

    await page.goto(`${WEB}/dashboard/projects/${id}`);
    await expect(stageButtons(page).filter({ hasText: "Quote sent" })).toHaveAttribute("aria-pressed", "true");
    await context.close();
  });

  test("reordering changes the stage bar order", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "ps-order");
    const s = await openSettings(page);
    await stageAction(s, "Waiting on decision", "Move earlier");
    await expect(steps(s).nth(1)).toHaveText("Waiting on decision");
    await stageAction(s, "Waiting on decision", "Move earlier");
    await expect(steps(s)).toHaveText(["Waiting on decision", "Lead", "Proposal sent"]);

    const id = await createPotential(page, "Warehouse lighting");
    await page.goto(`${WEB}/dashboard/projects/${id}`);
    await expect(stageButtons(page)).toHaveText(["Waiting on decision", "Lead", "Proposal sent"]);
    // New contracts start in the first stage; later ones are still to come.
    await expect(stageButtons(page).first()).toHaveAttribute("data-state", "current");
    await expect(stageButtons(page).nth(1)).toHaveAttribute("data-state", "upcoming");
    await context.close();
  });

  test("removing a stage moves its contracts", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "ps-remove");
    const id = await createPotential(page, "Clinic signage");
    await setStage(page, id, "waiting");

    const s = await openSettings(page);
    await stageAction(s, "Waiting on decision", "Delete");
    const dialog = page.getByRole("dialog", { name: /Delete .Waiting on decision/ });
    await dialog.getByLabel("Move its contracts to").selectOption({ label: "Proposal sent" });
    await dialog.getByRole("button", { name: "Delete stage" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(steps(s)).toHaveText(["Lead", "Proposal sent"]);

    await page.goto(`${WEB}/dashboard/projects/${id}`);
    await expect(stageButtons(page)).toHaveText(["Lead", "Proposal sent"]);
    await expect(stageButtons(page).filter({ hasText: "Proposal sent" })).toHaveAttribute("aria-pressed", "true");

    // The Bids pipeline is untouched.
    const bids = (await pipelines(page)).find((p) => p.name === "Bids")!;
    expect(bids.stages.map((st) => st.name)).toEqual([
      "Lead",
      "Proposal sent",
      "Waiting on decision",
    ]);
    await context.close();
  });

  test("a portal client can't read pipelines", async ({ browser }) => {
    const env = await createPortalClientProject(browser, "ps-client", "Signed site");
    const res = await env.client.request.get(`${API}/pursuit-pipelines`);
    expect(res.status()).toBe(403);
    await env.close();
  });
});
