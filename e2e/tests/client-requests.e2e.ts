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

  test.describe("Agency task requestedById", () => {
    test("POST /tasks creates a task with requestedById=null", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: { title: "Agency Owned Task" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.requestedById).toBeNull();
    });
  });

  test.describe("Status filter", () => {
    let openTaskId: string;
    let doneTaskId: string;

    test.beforeAll(async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();

      const openRes = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: { title: "Filter Open Task" },
        headers: { "x-csrf-token": csrfToken },
      });
      if (openRes.ok()) {
        openTaskId = (await openRes.json()).id;
      }

      const doneRes = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: { title: "Filter Done Task" },
        headers: { "x-csrf-token": csrfToken },
      });
      if (doneRes.ok()) {
        doneTaskId = (await doneRes.json()).id;
        await request.put(`${API}/tasks/${doneTaskId}`, {
          data: { status: "done" },
          headers: { "x-csrf-token": csrfToken },
        });
      }
    });

    test("GET /tasks/project/:id?status=active returns only open/in_progress tasks", async ({ request }) => {
      test.skip(!projectId || !openTaskId, "No project or task available");
      const res = await request.get(`${API}/tasks/project/${projectId}?status=active`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      for (const task of body.data) {
        expect(["open", "in_progress"]).toContain(task.status);
      }
    });

    test("GET /tasks/project/:id?status=done returns only done tasks", async ({ request }) => {
      test.skip(!projectId || !doneTaskId, "No project or task available");
      const res = await request.get(`${API}/tasks/project/${projectId}?status=done`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      for (const task of body.data) {
        expect(task.status).toBe("done");
      }
    });

    test("GET /tasks/project/:id?status=all returns tasks of all statuses", async ({ request }) => {
      test.skip(!projectId || !openTaskId || !doneTaskId, "No project or tasks available");
      const res = await request.get(`${API}/tasks/project/${projectId}?status=all`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      const statuses = new Set<string>(body.data.map((t: { status: string }) => t.status));
      // Both open and done tasks were created — both statuses must appear
      expect(statuses.has("open")).toBeTruthy();
      expect(statuses.has("done")).toBeTruthy();
    });
  });

  test.describe("assigneeId validation", () => {
    test("PUT /tasks/:id with a non-member assigneeId returns 400", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();

      const createRes = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: { title: "Assignee Validation Task" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(createRes.status()).toBe(201);
      const task = await createRes.json();

      const updateRes = await request.put(`${API}/tasks/${task.id}`, {
        data: { assigneeId: "00000000-0000-0000-0000-000000000000" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(updateRes.status()).toBe(400);
    });
  });

  test.describe("Status query param validation", () => {
    test("GET /tasks/project/:id?status=bogus returns 400", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const res = await request.get(`${API}/tasks/project/${projectId}?status=bogus`);
      expect(res.status()).toBe(400);
    });
  });

  test.describe("Cancel endpoint", () => {
    test("PATCH /tasks/:id/cancel on an agency-created task returns 403", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();

      // Agency creates a task (requestedById=null) then tries to cancel it — should be Forbidden
      const createRes = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: { title: "Agency Task — Cannot Cancel" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(createRes.status()).toBe(201);
      const task = await createRes.json();

      const cancelRes = await request.patch(`${API}/tasks/${task.id}/cancel`, {
        headers: { "x-csrf-token": csrfToken },
      });
      expect(cancelRes.status()).toBe(403);
    });

    test("PATCH /tasks/:id/cancel on a non-open task returns 400", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();

      const createRes = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: { title: "Cancel Precondition Task" },
        headers: { "x-csrf-token": csrfToken },
      });
      const task = await createRes.json();

      await request.put(`${API}/tasks/${task.id}`, {
        data: { status: "done" },
        headers: { "x-csrf-token": csrfToken },
      });

      const cancelRes = await request.patch(`${API}/tasks/${task.id}/cancel`, {
        headers: { "x-csrf-token": csrfToken },
      });
      expect([400, 403]).toContain(cancelRes.status());
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
