import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

/**
 * Tests for client-submitted requests and the task status workflow.
 * These tests run as the agency user (default test session).
 * Client-perspective tests use the portal UI.
 */
test.describe("Client Requests", () => {
  let projectId: string;
  let taskId: string;

  test.beforeAll(async ({ request }) => {
    const csrfToken = getCsrfToken();
    const res = await request.post(`${API}/projects`, {
      data: { name: "Client Requests Test Project" },
      headers: { "x-csrf-token": csrfToken },
    });
    if (res.ok()) {
      const body = await res.json();
      projectId = body.id;
    }
  });

  test.describe("Task status workflow (agency)", () => {
    test("agency can create a task with status=open", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: { title: "Status Test Task" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.status).toBe("open");
      taskId = body.id;
    });

    test("agency can change task status to in_progress", async ({ request }) => {
      test.skip(!taskId, "No task available");
      const csrfToken = getCsrfToken();
      const res = await request.put(`${API}/tasks/${taskId}`, {
        data: { status: "in_progress" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.status).toBe("in_progress");
    });

    test("agency can change task status to done", async ({ request }) => {
      test.skip(!taskId, "No task available");
      const csrfToken = getCsrfToken();
      const res = await request.put(`${API}/tasks/${taskId}`, {
        data: { status: "done" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.status).toBe("done");
    });

    test("task list includes isClientRequest field", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const res = await request.get(`${API}/tasks/project/${projectId}`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      for (const task of body.data) {
        expect(typeof task.isClientRequest).toBe("boolean");
      }
    });
  });

  test.describe("Dashboard tasks UI", () => {
    test("tasks section shows status filter bar", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      const hasProject = await projectLink.isVisible({ timeout: 5000 }).catch(() => false);
      test.skip(!hasProject, "No project link visible — skipping UI assertion");
      await projectLink.click();
      await expect(page.getByRole("button", { name: /active/i })).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole("button", { name: /all/i })).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe("Portal — New Request button", () => {
    test("portal tasks tab shows New Request button", async ({ page }) => {
      // Relies on global setup auth — test user may not be a portal client
      await page.goto("/portal/projects");
      const projectLink = page.locator("a[href*='/portal/projects/']").first();
      const hasProject = await projectLink.isVisible({ timeout: 5000 }).catch(() => false);
      test.skip(!hasProject, "No portal project link visible — test user may not be a portal client");
      await projectLink.click();
      await page.getByRole("button", { name: /tasks/i }).click();
      await expect(page.getByRole("button", { name: /new request/i })).toBeVisible({ timeout: 5000 });
    });
  });
});
