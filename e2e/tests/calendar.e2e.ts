import { test, expect, type APIRequestContext } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

async function getOrCreateProject(
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const listRes = await request.get(`${API}/projects?limit=100`);
  if (listRes.ok()) {
    const list = await listRes.json();
    const items: { id: string; name: string }[] = Array.isArray(list)
      ? list
      : (list.data ?? []);
    const found = items.find((p) => p.name === name);
    if (found) return found.id;
  }
  const csrfToken = getCsrfToken();
  const res = await request.post(`${API}/projects`, {
    data: { name },
    headers: { "x-csrf-token": csrfToken },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `Failed to create project (${res.status()}): ${body.slice(0, 200)}`,
    );
  }
  const body = await res.json();
  return body.id as string;
}

async function createTask(
  request: APIRequestContext,
  projectId: string,
  title: string,
  dueDate: Date,
): Promise<string> {
  const csrfToken = getCsrfToken();
  const res = await request.post(`${API}/tasks?projectId=${projectId}`, {
    data: { title, dueDate: dueDate.toISOString() },
    headers: { "x-csrf-token": csrfToken },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `Failed to create task (${res.status()}): ${body.slice(0, 200)}`,
    );
  }
  const body = await res.json();
  return body.id as string;
}

async function dismissTelemetry(page: import("@playwright/test").Page): Promise<void> {
  const noThanks = page.getByRole("button", { name: /^no thanks$/i });
  if (await noThanks.isVisible({ timeout: 2000 }).catch(() => false)) {
    await noThanks.click();
  }
}

function midOfMonth(): Date {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), 15, 12, 0, 0);
}

test.describe("Calendar", () => {
  test("month grid renders task on its due date", async ({ page, request }) => {
    const projectId = await getOrCreateProject(request, "Calendar E2E");
    const title = `Cal grid task ${Date.now()}`;
    await createTask(request, projectId, title, midOfMonth());

    await page.goto("/dashboard/calendar");
    await dismissTelemetry(page);
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10000 });
  });

  test("project filter narrows the grid", async ({ page, request }) => {
    // Free plan caps orgs at 2 projects; ensure both slots are filled.
    await getOrCreateProject(request, "Calendar E2E");
    await getOrCreateProject(request, "Calendar Filter E2E").catch(() => null);
    const listRes = await request.get(`${API}/projects?limit=100`);
    const list = await listRes.json();
    const items: { id: string; name: string }[] = Array.isArray(list)
      ? list
      : (list.data ?? []);
    test.skip(items.length < 2, "Need at least 2 projects in the org for this test");
    const [pa, pb] = items;
    const titleA = `Cal A ${Date.now()}`;
    const titleB = `Cal B ${Date.now()}`;
    const due = new Date(midOfMonth().getFullYear(), midOfMonth().getMonth(), 16, 12, 0, 0);
    await createTask(request, pa.id, titleA, due);
    await createTask(request, pb.id, titleB, due);

    await page.goto("/dashboard/calendar");
    await dismissTelemetry(page);
    await expect(page.getByText(titleA).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(titleB).first()).toBeVisible();

    // Wait for the project options to load before selecting.
    await expect(
      page.locator("select").first().locator(`option[value="${pa.id}"]`),
    ).toHaveCount(1, { timeout: 10000 });
    await page.locator("select").first().selectOption(pa.id);
    await expect(page.getByText(titleA).first()).toBeVisible();
    await expect(page.getByText(titleB)).toHaveCount(0);
  });

  test("clicking task chip navigates to project task deep link", async ({ page, request }) => {
    const projectId = await getOrCreateProject(request, "Calendar E2E");
    const title = `Cal click ${Date.now()}`;
    await createTask(request, projectId, title, new Date(midOfMonth().getFullYear(), midOfMonth().getMonth(), 17, 12, 0, 0));

    await page.goto("/dashboard/calendar");
    await dismissTelemetry(page);
    await page.getByText(title).first().click();
    await page.waitForURL(/\/dashboard\/projects\/[^/]+\?tab=tasks&task=/);
  });

  test("agenda view lists future items grouped by date", async ({ page, request }) => {
    const projectId = await getOrCreateProject(request, "Calendar E2E");
    const title = `Cal agenda ${Date.now()}`;
    await createTask(request, projectId, title, new Date(midOfMonth().getFullYear(), midOfMonth().getMonth(), 18, 12, 0, 0));

    await page.goto("/dashboard/calendar");
    await dismissTelemetry(page);
    await page.getByRole("button", { name: /^agenda$/i }).click();
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10000 });
  });
});
