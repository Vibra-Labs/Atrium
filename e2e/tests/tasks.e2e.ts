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

    test("an empty project shows one quiet line each, with no task filters", async ({ page, request }) => {
      const emptyId = await getOrCreateProject(request, `Empty Task Project ${Date.now()}`);
      await openProjectTab(page, emptyId, "tasks");
      await expect(page.getByText("No tasks yet.")).toBeVisible({ timeout: 10000 });
      await expect(page.getByText("No updates yet. Post one above.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Active", exact: true })).toHaveCount(0);
    });

    test("a task's checkbox marks it done and back", async ({ page, request }) => {
      const id = await getOrCreateProject(request, `Checkbox Project ${Date.now()}`);
      const res = await request.post(`${API}/tasks?projectId=${id}`, {
        data: { title: "Tick me" },
        headers: { "x-csrf-token": getCsrfToken() },
      });
      expect(res.ok()).toBe(true);
      await openProjectTab(page, id, "tasks");
      await page.getByRole("checkbox", { name: "Mark Tick me done" }).click();
      // Done tasks leave the Active list.
      await expect(page.getByText("Tick me")).toHaveCount(0, { timeout: 10000 });
      await page.getByLabel("Show tasks").selectOption("done");
      await page.getByRole("checkbox", { name: "Reopen Tick me" }).click();
      await expect(page.getByText("Tick me")).toHaveCount(0, { timeout: 10000 });
    });

    test("the update box is one line until you click into it", async ({ page, request }) => {
      const id = await getOrCreateProject(request, `Composer Project ${Date.now()}`);
      await openProjectTab(page, id, "tasks");
      const box = page.getByLabel("Write an update");
      await expect(box).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole("button", { name: "Post Update" })).toHaveCount(0);
      await box.click();
      await expect(page.getByRole("button", { name: "Post Update" })).toBeVisible();
    });

    test("project detail has add task form when not archived", async ({ page }) => {
      await openProjectTab(page, projectId, "tasks");
      await page.getByRole("button", { name: "Add", exact: true }).click();
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
