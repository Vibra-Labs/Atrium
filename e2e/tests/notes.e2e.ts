import { test, expect } from "@playwright/test";
import { getCsrfToken, getOrCreateProject, openProjectTab } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Internal Notes", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    projectId = await getOrCreateProject(request, "Notes Test Project");
  });

  test.describe("Dashboard project detail", () => {
    test("project detail page shows notes tab and content", async ({ page }) => {
      await openProjectTab(page, projectId, "notes");
      await expect(page.getByText(/team only/i)).toBeVisible({ timeout: 10000 });
    });

    test("notes tab can add a note", async ({ page }) => {
      await openProjectTab(page, projectId, "notes");
      const content = `UI note ${Date.now()}`;
      await page.getByPlaceholder("Write an internal note...").fill(content);
      await page.getByRole("button", { name: /add note/i }).click();
      await expect(page.getByText(content)).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe("API", () => {
    test("create note via API", async ({ request }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/notes?projectId=${projectId}`, {
        data: { content: "E2E test internal note" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.content).toBe("E2E test internal note");
    });

    test("list notes via API", async ({ request }) => {
      const res = await request.get(`${API}/notes/project/${projectId}`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
    });

    test("delete note via API", async ({ request }) => {
      const csrfToken = getCsrfToken();
      const createRes = await request.post(`${API}/notes?projectId=${projectId}`, {
        data: { content: "Note to delete" },
        headers: { "x-csrf-token": csrfToken },
      });
      const note = await createRes.json();

      const res = await request.delete(`${API}/notes/${note.id}`, {
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
    });

    test("notes API has no client-facing routes", async ({ request }) => {
      // There should be no /notes/mine endpoint
      const res = await request.get(`${API}/notes/mine`);
      expect(res.status()).toBeGreaterThanOrEqual(400);
    });
  });
});
