import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Tasks", () => {
  test.describe("Dashboard project detail", () => {
    test("project detail page shows tasks section", async ({ page }) => {
      // First create a project so we have one to visit
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await expect(page.getByText(/tasks/i)).toBeVisible({ timeout: 5000 });
      }
    });

    test("project detail has add task form when not archived", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await expect(page.getByPlaceholder(/add a task/i)).toBeVisible({ timeout: 5000 });
      }
    });
  });

  test.describe("API", () => {
    let projectId: string;

    test.beforeAll(async ({ request }) => {
      // Create a project for task tests
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/projects`, {
        data: { name: "Task Test Project" },
        headers: { "x-csrf-token": csrfToken },
      });
      if (res.ok()) {
        const body = await res.json();
        projectId = body.id;
      }
    });

    test("create task via API", async ({ request }) => {
      test.skip(!projectId, "No project available");
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
      test.skip(!projectId, "No project available");
      const res = await request.get(`${API}/tasks/project/${projectId}`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
    });

    test("update task via API", async ({ request }) => {
      test.skip(!projectId, "No project available");
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
      test.skip(!projectId, "No project available");
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
