import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { createOwner, createPortalClientProject, getCsrfTokenFromContext } from "./helpers";

const API = "http://localhost:3001/api";
const WEB = "http://localhost:3000";

async function headersFor(page: Page): Promise<Record<string, string>> {
  return { "x-csrf-token": await getCsrfTokenFromContext(page.context()) };
}

async function createProject(page: Page, name: string, status?: string): Promise<string> {
  const headers = await headersFor(page);
  const res = await page.request.post(`${API}/projects`, { data: { name }, headers });
  expect(res.ok()).toBe(true);
  const id = ((await res.json()) as { id: string }).id;
  if (status) {
    const put = await page.request.put(`${API}/projects/${id}`, { data: { status }, headers });
    expect(put.ok()).toBe(true);
  }
  return id;
}

async function openSettings(page: Page): Promise<Locator> {
  await page.goto(`${WEB}/dashboard/settings/workspace`);
  const s = page.locator("section", { has: page.getByRole("heading", { name: "Project statuses" }) });
  await expect(chips(s).first()).toBeVisible({ timeout: 15000 });
  return s;
}

function chips(s: Locator): Locator {
  return s.getByTestId("project-status-chip");
}

async function chipAction(s: Locator, name: string, item: string): Promise<void> {
  await chips(s).filter({ hasText: name }).click();
  await s.getByRole("menuitem", { name: item }).click();
}

test.describe("Project statuses", () => {
  test("a workspace starts with the five built-in statuses; they can't be deleted", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "st-defaults");
    const s = await openSettings(page);
    await expect(chips(s)).toHaveText(["Not Started", "In Progress", "In Review", "Completed", "Cancelled"]);
    await chips(s).filter({ hasText: "Completed" }).click();
    await expect(s.getByText("Built in: can be renamed, not deleted")).toBeVisible();
    await expect(s.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
    await context.close();
  });

  test("add a status and use it on a project", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "st-add");
    const s = await openSettings(page);
    await s.getByRole("button", { name: "Add a status" }).click();
    await s.getByLabel("New status").fill("Design");
    await s.getByRole("button", { name: "Add", exact: true }).click();
    await expect(chips(s)).toHaveText(["Not Started", "In Progress", "In Review", "Completed", "Cancelled", "Design"]);
    await chipAction(s, "Design", "Move earlier");
    await expect(chips(s).nth(4)).toHaveText("Design");

    const id = await createProject(page, "Brand refresh");
    await page.goto(`${WEB}/dashboard/projects/${id}`);
    await page.getByRole("button", { name: "Design", exact: true }).click();
    await page.goto(`${WEB}/dashboard/projects`);
    await expect(page.getByRole("link", { name: /Brand refresh/ })).toContainText("Design");
    await context.close();
  });

  test("renaming a built-in status changes it everywhere and it still counts as completed", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "st-rename");
    const id = await createProject(page, "Clinic signage", "completed");
    const s = await openSettings(page);
    await chipAction(s, "Completed", "Rename");
    const input = s.getByRole("textbox", { name: "Rename Completed" });
    await input.fill("Delivered");
    await input.press("Enter");
    await expect(chips(s).nth(3)).toHaveText("Delivered");

    await page.goto(`${WEB}/dashboard/projects/${id}`);
    await expect(page.getByRole("button", { name: "Delivered", exact: true })).toBeVisible();
    const stats = (await (await page.request.get(`${API}/projects/stats`)).json()) as { completed: number };
    expect(stats.completed).toBe(1);
    await context.close();
  });

  test("deleting a status moves its projects", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "st-delete");
    const headers = await headersFor(page);
    const created = await page.request.post(`${API}/project-statuses`, { data: { name: "On hold" }, headers });
    expect(created.ok()).toBe(true);
    const id = await createProject(page, "Paused site", "on_hold");

    const s = await openSettings(page);
    await chipAction(s, "On hold", "Delete");
    const dialog = page.getByRole("dialog", { name: /Delete .On hold/ });
    await dialog.getByLabel("Move its projects to").selectOption({ label: "In Progress" });
    await dialog.getByRole("button", { name: "Delete status" }).click();
    await expect(chips(s).filter({ hasText: "On hold" })).toHaveCount(0);

    const project = (await (await page.request.get(`${API}/projects/${id}`)).json()) as { status: string };
    expect(project.status).toBe("in_progress");
    // Built-in ones are refused by the API too.
    const statuses = (await (await page.request.get(`${API}/projects/statuses`)).json()) as { id: string; slug: string }[];
    const completed = statuses.find((st) => st.slug === "completed")!.id;
    const refused = await page.request.delete(`${API}/project-statuses/${completed}?moveTo=${statuses[0].id}`, { headers });
    expect(refused.status()).toBe(400);
    await context.close();
  });

  test("a client sees the workspace's names, and can't edit statuses", async ({ browser }) => {
    const env = await createPortalClientProject(browser, "st-client", "Signed site");
    const statuses = (await (await env.owner.request.get(`${API}/projects/statuses`)).json()) as { id: string; slug: string }[];
    const notStarted = statuses.find((st) => st.slug === "not_started")!.id;
    const renamed = await env.owner.request.patch(`${API}/project-statuses/${notStarted}`, {
      data: { name: "Kickoff" },
      headers: env.ownerHeaders,
    });
    expect(renamed.ok()).toBe(true);

    await env.client.goto(`${WEB}/portal/projects`);
    await expect(env.client.getByText("Kickoff")).toBeVisible({ timeout: 15000 });
    const blocked = await env.client.request.post(`${API}/project-statuses`, {
      data: { name: "Mine" },
      headers: { "x-csrf-token": await getCsrfTokenFromContext(env.client.context()) },
    });
    expect(blocked.status()).toBe(403);
    await env.close();
  });
});
