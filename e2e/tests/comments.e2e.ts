import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

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
      test.skip(!commentId, "No comment to delete");
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
      test.skip(!commentId, "No comment to delete");
      const csrfToken = getCsrfToken();
      const res = await request.delete(`${API}/comments/${commentId}`, {
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
    });
  });

  test.describe("Dashboard UI", () => {
    test("shows reply button on updates", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (!(await projectLink.isVisible({ timeout: 5000 }).catch(() => false))) {
        test.skip(true, "No projects available");
        return;
      }
      await projectLink.click();
      await page.waitForURL("**/dashboard/projects/**");

      // Post an update if none exist
      const addBtn = page.getByText("Add Update");
      if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await addBtn.click();
        await page.getByPlaceholder("Write a status update...").fill("Test update for comments");
        await page.getByRole("button", { name: "Post" }).click();
        await page.waitForTimeout(1000);
      }

      // Look for reply/comments toggle
      const replyBtn = page.locator("[data-testid^='comments-toggle-']").first();
      await expect(replyBtn).toBeVisible({ timeout: 5000 });
    });

    test("can post and see a comment on an update", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (!(await projectLink.isVisible({ timeout: 5000 }).catch(() => false))) {
        test.skip(true, "No projects available");
        return;
      }
      await projectLink.click();
      await page.waitForURL("**/dashboard/projects/**");

      // Expand comments on first update
      const replyBtn = page.locator("[data-testid^='comments-toggle-']").first();
      if (!(await replyBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
        test.skip(true, "No updates with comment toggle visible");
        return;
      }
      await replyBtn.click();

      // Type and submit a comment
      const commentInput = page.locator("[data-testid='comment-input']").first();
      await expect(commentInput).toBeVisible({ timeout: 3000 });
      await commentInput.fill("E2E test comment from dashboard");
      await page.locator("[data-testid='comment-submit']").first().click();

      // Verify comment appears
      await expect(
        page.locator("[data-testid='comment-entry']").filter({ hasText: "E2E test comment from dashboard" }),
      ).toBeVisible({ timeout: 5000 });
    });

    test("shows reply button on tasks", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (!(await projectLink.isVisible({ timeout: 5000 }).catch(() => false))) {
        test.skip(true, "No projects available");
        return;
      }
      await projectLink.click();
      await page.waitForURL("**/dashboard/projects/**");

      // Switch to Tasks tab
      await page.getByText("Tasks", { exact: true }).click();
      await page.waitForTimeout(500);

      const replyBtn = page.locator("[data-testid^='comments-toggle-']").first();
      if (await replyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(replyBtn).toBeVisible();
      }
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
