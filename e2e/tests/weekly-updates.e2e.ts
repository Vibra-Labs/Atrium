import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe.serial("Weekly client updates", () => {
  const projectName = `Weekly ${Date.now()}`;
  const doneTitle = `Homepage design ${Date.now()}`;
  const nextTitle = `About page ${Date.now()}`;
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    const headers = { "x-csrf-token": getCsrfToken() };
    const session = await (await request.get(`${API}/auth/get-session`)).json();
    const userId: string = session.user.id;

    // A client is what makes a project need weekly updates; the owner stands in for one here.
    const projectRes = await request.post(`${API}/projects`, {
      data: { name: projectName, clientUserIds: [userId] },
      headers,
    });
    expect(projectRes.ok(), await projectRes.text()).toBe(true);
    projectId = (await projectRes.json()).id;

    const done = await (await request.post(`${API}/tasks?projectId=${projectId}`, { data: { title: doneTitle }, headers })).json();
    const markDone = await request.put(`${API}/tasks/${done.id}`, { data: { status: "done" }, headers });
    expect(markDone.ok(), await markDone.text()).toBe(true);
    const next = await request.post(`${API}/tasks?projectId=${projectId}`, { data: { title: nextTitle }, headers });
    expect(next.ok()).toBe(true);
  });

  test("drafts an update from the week's finished and upcoming tasks", async ({ request }) => {
    const res = await request.get(`${API}/updates/weekly-draft/${projectId}`);
    expect(res.ok()).toBe(true);
    const draft: { content: string; stats: { completedTasks: number } } = await res.json();
    expect(draft.content).toContain(`Here's where ${projectName} stands this week.`);
    expect(draft.content).toContain(`Done this week:\n- ${doneTitle}`);
    expect(draft.content).toContain(`Up next:\n- ${nextTitle}`);
    expect(draft.stats.completedTasks).toBe(1);
  });

  test("returns 404 for a project outside the workspace", async ({ request }) => {
    const res = await request.get(`${API}/updates/weekly-draft/not-a-real-project`);
    expect(res.status()).toBe(404);
  });

  test("dashboard lists the project, drafts the update, and clears it once posted", async ({ page }) => {
    await page.goto("/dashboard");
    const card = page.getByTestId("weekly-updates-card");
    await expect(card).toBeVisible({ timeout: 15000 });
    const row = card.getByRole("listitem").filter({ hasText: projectName });
    await expect(row).toContainText("No updates yet");

    await row.getByRole("link", { name: "Draft update" }).click();
    await page.waitForURL(new RegExp(`/dashboard/projects/${projectId}\\?tab=updates&compose=weekly`));

    const composer = page.getByPlaceholder("Write an update for your client…");
    await expect(composer).toHaveValue(new RegExp(doneTitle), { timeout: 15000 });
    await expect(page.getByTestId("weekly-draft-hint")).toContainText("every client on this project gets it by email");

    await composer.fill(`${await composer.inputValue()}\n\nThanks for the quick feedback on the homepage!`);
    await page.getByRole("button", { name: "Post Update", exact: true }).click();
    await expect(page.getByText("Update posted")).toBeVisible({ timeout: 10000 });

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
    // Give the card's fetch time to land, then confirm this project dropped off.
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("weekly-updates-card").getByText(projectName)).toHaveCount(0);
  });

  test("the composer can draft on demand from the Updates tab", async ({ page }) => {
    await page.goto(`/dashboard/projects/${projectId}?tab=updates`);
    // The composer is always open on the Updates tab.
    await page.getByRole("button", { name: "Draft from this week" }).click();
    await expect(page.getByPlaceholder("Write an update for your client…")).toHaveValue(new RegExp(nextTitle), {
      timeout: 10000,
    });
  });
});
