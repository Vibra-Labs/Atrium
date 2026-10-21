import { test, expect } from "@playwright/test";
import { getCsrfToken, openProjectTab } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Comments", () => {
  let projectId: string;
  let updateId: string;
  let taskId: string;

  test.beforeAll(async ({ request }) => {
    const csrfToken = getCsrfToken();

    // Create a project
    const projectRes = await request.post(`${API}/projects`, {
      data: { name: "Comments Test Project" },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(projectRes.ok()).toBeTruthy();
    const project = await projectRes.json();
    projectId = project.id;

    // Create an update (multipart form)
    const boundary = "----CommentBoundary" + Date.now();
    const parts = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="content"',
      "",
      "Update for comment testing",
      `--${boundary}--`,
    ];
    const updateRes = await request.post(
      `${API}/updates?projectId=${projectId}`,
      {
        data: parts.join("\r\n"),
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      },
    );
    expect(updateRes.ok()).toBeTruthy();
    const update = await updateRes.json();
    updateId = update.id;

    // Create a task
    const taskRes = await request.post(
      `${API}/tasks?projectId=${projectId}`,
      {
        data: { title: "Task for comment testing" },
        headers: { "x-csrf-token": csrfToken },
      },
    );
    expect(taskRes.ok()).toBeTruthy();
    const task = await taskRes.json();
    taskId = task.id;
  });

  test.describe("Update comments API", () => {
    // The delete step removes the comment the first step created.
    test.describe.configure({ mode: "serial" });
    let commentId: string;

    test("can add a comment to an update", async ({ request }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/comments/update/${updateId}`, {
        data: { content: "This is a test comment on an update" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.content).toBe("This is a test comment on an update");
      expect(body.id).toBeTruthy();
      commentId = body.id;
    });

    test("can list comments on an update", async ({ request }) => {
      const res = await request.get(`${API}/comments/update/${updateId}`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0].author).toBeDefined();
      expect(body.data[0].author.name).toBeTruthy();
    });

    test("can delete own comment", async ({ request }) => {
      const csrfToken = getCsrfToken();
      const res = await request.delete(`${API}/comments/${commentId}`, {
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
    });

    test("comment count appears in timeline", async ({ request }) => {
      const csrfToken = getCsrfToken();
      // Add a comment first
      await request.post(`${API}/comments/update/${updateId}`, {
        data: { content: "Comment for count test" },
        headers: { "x-csrf-token": csrfToken },
      });

      const res = await request.get(
        `${API}/updates/timeline/${projectId}?page=1&limit=10`,
      );
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      const updateEntry = body.data.find(
        (e: { id: string; kind: string }) =>
          e.kind === "update" && e.id === updateId,
      );
      expect(updateEntry).toBeDefined();
      expect(updateEntry.commentCount).toBeGreaterThan(0);
    });
  });

  test.describe("Task comments API", () => {
    // The delete step removes the comment the first step created.
    test.describe.configure({ mode: "serial" });
    let commentId: string;

    test("can add a comment to a task", async ({ request }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/comments/task/${taskId}`, {
        data: { content: "This is a test comment on a task" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.content).toBe("This is a test comment on a task");
      commentId = body.id;
    });

    test("can list comments on a task", async ({ request }) => {
      const res = await request.get(`${API}/comments/task/${taskId}`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThan(0);
    });

    test("comment count appears in task list", async ({ request }) => {
      const res = await request.get(
        `${API}/tasks/project/${projectId}?page=1&limit=20`,
      );
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      const task = body.data.find((t: { id: string }) => t.id === taskId);
      expect(task).toBeDefined();
      expect(task._count.comments).toBeGreaterThan(0);
    });

    test("can delete own task comment", async ({ request }) => {
      const csrfToken = getCsrfToken();
      const res = await request.delete(`${API}/comments/${commentId}`, {
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
    });
  });

  test.describe("Dashboard UI", () => {
    test("shows reply button on updates", async ({ page }) => {
      await openProjectTab(page, projectId, "updates");
      await expect(page.getByTestId(`comments-toggle-${updateId}`)).toBeVisible({ timeout: 10000 });
    });

    test("can post and see a comment on an update", async ({ page }) => {
      await openProjectTab(page, projectId, "updates");
      await page.getByTestId(`comments-toggle-${updateId}`).click({ timeout: 10000 });

      const list = page.getByTestId(`comments-list-${updateId}`);
      const content = `E2E dashboard comment ${Date.now()}`;
      await list.getByTestId("comment-input").fill(content);
      await list.getByTestId("comment-submit").click();

      await expect(list.getByTestId("comment-entry").filter({ hasText: content })).toBeVisible({ timeout: 10000 });
    });

    test("task detail modal shows comments and accepts a new one", async ({ page }) => {
      await page.goto(`/dashboard/projects/${projectId}?task=${taskId}`);
      const modal = page.getByTestId("task-detail-modal");
      await expect(modal).toBeVisible({ timeout: 15000 });

      const content = `E2E task comment ${Date.now()}`;
      await modal.getByTestId("comment-input").fill(content);
      await modal.getByTestId("comment-submit").click();
      await expect(modal.getByTestId("comment-entry").filter({ hasText: content })).toBeVisible({ timeout: 10000 });
    });
  });

  test.afterAll(async ({ request }) => {
    if (!projectId) return;
    const csrfToken = getCsrfToken();
    await request.delete(`${API}/projects/${projectId}`, {
      headers: { "x-csrf-token": csrfToken },
    });
  });
});
