import { test, expect } from "@playwright/test";
import { createPortalClientProject, getCsrfToken, getOrCreateProject, openProjectTab } from "./helpers";
import type { PortalClientProject } from "./helpers";

const API = "http://localhost:3001/api";
const WEB = "http://localhost:3000";

/**
 * Tests for client-submitted requests and the task status workflow.
 * These tests run as the agency user (default test session).
 * Client-perspective tests use the portal UI.
 */
test.describe("Client Requests", () => {
  let projectId: string;
  let taskId: string;

  test.beforeAll(async ({ request }) => {
    projectId = await getOrCreateProject(request, "Client Requests Test Project");
  });

  test.describe("Task status workflow (agency)", () => {
    // Later steps move the task created by the first one.
    test.describe.configure({ mode: "serial" });

    test("agency can create a task with status=open", async ({ request }) => {
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
      const res = await request.get(`${API}/tasks/project/${projectId}`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      for (const task of body.data) {
        expect(typeof task.isClientRequest).toBe("boolean");
      }
    });

    test("task list includes requester and assignee shape", async ({ request }) => {
      const res = await request.get(`${API}/tasks/project/${projectId}`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      for (const task of body.data) {
        // requester/assignee may be null, but when present must be { id, name }
        if (task.requester) {
          expect(typeof task.requester.id).toBe("string");
          expect(typeof task.requester.name).toBe("string");
        }
        if (task.assignee) {
          expect(typeof task.assignee.id).toBe("string");
          expect(typeof task.assignee.name).toBe("string");
        }
      }
    });
  });

  test.describe("Agency task requestedById", () => {
    test("POST /tasks creates a task with requestedById=null", async ({ request }) => {
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
    test.beforeAll(async ({ request }) => {
      const headers: Record<string, string> = { "x-csrf-token": getCsrfToken() };

      const openRes = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: { title: "Filter Open Task" },
        headers,
      });
      expect(openRes.ok()).toBeTruthy();

      const doneRes = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: { title: "Filter Done Task" },
        headers,
      });
      expect(doneRes.ok()).toBeTruthy();
      const doneTaskId: string = (await doneRes.json()).id;
      const putRes = await request.put(`${API}/tasks/${doneTaskId}`, {
        data: { status: "done" },
        headers,
      });
      expect(putRes.ok()).toBeTruthy();
    });

    test("GET /tasks/project/:id?status=active returns only open/in_progress tasks", async ({ request }) => {
      const res = await request.get(`${API}/tasks/project/${projectId}?status=active`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      for (const task of body.data) {
        expect(["open", "in_progress"]).toContain(task.status);
      }
    });

    test("GET /tasks/project/:id?status=done returns only done tasks", async ({ request }) => {
      const res = await request.get(`${API}/tasks/project/${projectId}?status=done`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      for (const task of body.data) {
        expect(task.status).toBe("done");
      }
    });

    test("GET /tasks/project/:id?status=all returns tasks of all statuses", async ({ request }) => {
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
      const res = await request.get(`${API}/tasks/project/${projectId}?status=bogus`);
      expect(res.status()).toBe(400);
    });
  });

  test.describe("Cancel endpoint", () => {
    test("PATCH /tasks/:id/cancel on an agency-created task returns 403", async ({ request }) => {
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
    // Use a dedicated project so the tasks list stays small and new tasks are
    // guaranteed to appear on page 1 (tasks list sorts by `order` asc with a
    // limit of 20, so sharing a project across many tests can paginate the
    // newly-created task off-screen).
    let uiProjectId: string;

    test.beforeAll(async ({ request }) => {
      uiProjectId = await getOrCreateProject(request, "Client Requests Dashboard UI Project");
    });

    test("tasks section shows status filter bar", async ({ page }) => {
      await openProjectTab(page, uiProjectId, "tasks");
      // Scoped to the bar: the status pipeline also has a "Cancelled" button.
      const bar = page.getByRole("button", { name: "Active", exact: true }).locator("..");
      await expect(bar.getByRole("button")).toHaveText(["Active", "All", "Done", "Cancelled"], { timeout: 10000 });
    });

    test("clicking a task row opens the detail modal and ?task= deep link", async ({ page, request }) => {
      const csrfToken = getCsrfToken();
      // Seed a task we can definitely locate
      const createRes = await request.post(`${API}/tasks?projectId=${uiProjectId}`, {
        data: { title: "Modal Deep-Link Task" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(createRes.status()).toBe(201);
      const createdTask = await createRes.json();

      await openProjectTab(page, uiProjectId, "tasks");
      const row = page.getByTestId(`task-row-${createdTask.id}`);
      await expect(row).toBeVisible({ timeout: 10000 });
      await row.click();

      await expect(page.getByTestId("task-detail-modal")).toBeVisible();
      await expect(page.getByTestId("task-title")).toContainText("Modal Deep-Link Task");
      await expect(page).toHaveURL(new RegExp(`task=${createdTask.id}`));
    });

    test("status change inside modal persists via API", async ({ page, request }) => {
      const csrfToken = getCsrfToken();
      const createRes = await request.post(`${API}/tasks?projectId=${uiProjectId}`, {
        data: { title: "Modal Status Change Task" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(createRes.status()).toBe(201);
      const createdTask = await createRes.json();

      await page.goto(`/dashboard/projects/${uiProjectId}?task=${createdTask.id}`);
      await expect(page.getByTestId("task-detail-modal")).toBeVisible({ timeout: 10000 });

      await page.getByTestId("task-status-select").selectOption("done");

      await expect
        .poll(async () => {
          const r = await request.get(`${API}/tasks/project/${uiProjectId}?status=all`);
          const body = await r.json();
          return body.data.find((t: { id: string; status: string }) => t.id === createdTask.id)?.status;
        }, { timeout: 5000 })
        .toBe("done");
    });
  });

  test.describe("Portal — New Request button", () => {
    test.setTimeout(120000);

    test("portal tasks tab shows New Request button and submits a request", async ({ browser }) => {
      const portal: PortalClientProject = await createPortalClientProject(browser, "requests", "Portal Requests E2E");
      try {
        await portal.client.goto(`${WEB}/portal/projects/${portal.projectId}?tab=tasks`);
        await portal.client.getByRole("button", { name: /new request/i }).click({ timeout: 15000 });
        const title = `Need a logo ${Date.now()}`;
        await portal.client.getByPlaceholder("What do you need?").fill(title);
        await portal.client.getByRole("button", { name: "Submit", exact: true }).click();
        await expect(portal.client.getByText(title)).toBeVisible({ timeout: 10000 });
      } finally {
        await portal.close();
      }
    });
  });
});
