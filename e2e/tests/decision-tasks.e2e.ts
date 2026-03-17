import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Decision Tasks", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    const csrfToken = getCsrfToken();
    const res = await request.post(`${API}/projects`, {
      data: { name: "Decision Task Test Project" },
      headers: { "x-csrf-token": csrfToken },
    });
    if (res.ok()) {
      const body = await res.json();
      projectId = body.id;
    }
  });

  test.describe("API", () => {
    test("create decision task via API", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: {
          title: "Which logo do you prefer?",
          type: "decision",
          question: "Which logo do you prefer?",
          options: [
            { label: "Logo A" },
            { label: "Logo B" },
            { label: "Logo C" },
          ],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.type).toBe("decision");
      expect(body.question).toBe("Which logo do you prefer?");
      expect(body.options).toHaveLength(3);
      expect(body.options[0].label).toBe("Logo A");
    });

    test("decision task requires at least 2 options", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: {
          title: "Bad Decision",
          type: "decision",
          question: "Only one option?",
          options: [{ label: "Only option" }],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBeGreaterThanOrEqual(400);
    });

    test("decision task requires a question", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: {
          title: "No Question",
          type: "decision",
          options: [{ label: "A" }, { label: "B" }],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBeGreaterThanOrEqual(400);
    });

    test("list tasks includes decision task with options", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const res = await request.get(`${API}/tasks/project/${projectId}`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      const decisions = body.data.filter((t: { type: string }) => t.type === "decision");
      expect(decisions.length).toBeGreaterThan(0);
      expect(decisions[0].options).toBeInstanceOf(Array);
    });

    test("close voting on decision task", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();

      // Create a decision task
      const createRes = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: {
          title: "Close Vote Test",
          type: "decision",
          question: "Close me?",
          options: [{ label: "Yes" }, { label: "No" }],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      const task = await createRes.json();

      // Close voting
      const res = await request.post(`${API}/tasks/${task.id}/close`, {
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.closedAt).toBeTruthy();
      expect(body.completed).toBe(true);
    });

    test("cannot close voting twice", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();

      const createRes = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: {
          title: "Double Close Test",
          type: "decision",
          question: "Double close?",
          options: [{ label: "A" }, { label: "B" }],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      const task = await createRes.json();

      // Close once
      await request.post(`${API}/tasks/${task.id}/close`, {
        headers: { "x-csrf-token": csrfToken },
      });

      // Try again
      const res = await request.post(`${API}/tasks/${task.id}/close`, {
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBeGreaterThanOrEqual(400);
    });

    test("vote endpoint requires project assignment", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();

      const createRes = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: {
          title: "Vote Access Test",
          type: "decision",
          question: "Vote?",
          options: [{ label: "X" }, { label: "Y" }],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      const task = await createRes.json();

      // Try to vote as the owner (not a project client)
      const res = await request.post(`${API}/tasks/${task.id}/vote`, {
        data: { optionId: task.options[0].id },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBeGreaterThanOrEqual(400);
    });

    test("delete decision task via API", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();

      const createRes = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: {
          title: "Delete Decision",
          type: "decision",
          question: "Delete me?",
          options: [{ label: "A" }, { label: "B" }],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      const task = await createRes.json();

      const res = await request.delete(`${API}/tasks/${task.id}`, {
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
    });

    test("checkbox tasks still work normally", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: { title: "Regular Checkbox Task" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.type).toBe("checkbox");
      expect(body.options).toBeFalsy();
    });
  });

  test.describe("Dashboard UI", () => {
    test("project detail has task type toggle", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^tasks$/i }).click();
        await expect(page.getByRole("button", { name: /decision/i })).toBeVisible({ timeout: 5000 });
      }
    });
  });
});
