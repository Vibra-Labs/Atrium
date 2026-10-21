import { test, expect } from "@playwright/test";
import { getCsrfToken, getOrCreateProject, openProjectTab } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Tasks", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    projectId = await getOrCreateProject(request, "Task Test Project");
  });

  test.describe("Dashboard project detail", () => {
    test("project detail page shows tasks section", async ({ page }) => {
      await openProjectTab(page, projectId, "tasks");
      await expect(page.getByRole("heading", { name: /^Tasks/ })).toBeVisible({ timeout: 10000 });
    });

    test("project detail has add task form when not archived", async ({ page }) => {
      await openProjectTab(page, projectId, "tasks");
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await page.getByRole("button", { name: "Task", exact: true }).click();
      const input = page.getByPlaceholder("Add a task...");
      await expect(input).toBeVisible();

      const title = `UI Task ${Date.now()}`;
      await input.fill(title);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByText(title)).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe("API", () => {
    test("create task via API", async ({ request }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: { title: "E2E Test Task" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.title).toBe("E2E Test Task");
      expect(body.status).toBe("open");
    });

    test("list tasks via API", async ({ request }) => {
      const res = await request.get(`${API}/tasks/project/${projectId}`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
    });

    test("update task via API", async ({ request }) => {
      const csrfToken = getCsrfToken();
      // Create a task first
      const createRes = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: { title: "Task to Update" },
        headers: { "x-csrf-token": csrfToken },
      });
      const task = await createRes.json();

      const res = await request.put(`${API}/tasks/${task.id}`, {
        data: { status: "done" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.status).toBe("done");
    });

    test("delete task via API", async ({ request }) => {
      const csrfToken = getCsrfToken();
      const createRes = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: { title: "Task to Delete" },
        headers: { "x-csrf-token": csrfToken },
      });
      const task = await createRes.json();

      const res = await request.delete(`${API}/tasks/${task.id}`, {
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
    });
  });
});
