import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Global Search", () => {
  test.describe("API validation", () => {
    test("GET /search with no q returns 400", async ({ request }) => {
      const res = await request.get(`${API}/search`);
      expect(res.status()).toBe(400);
    });

    test("GET /search?q=a (1 char) returns 400", async ({ request }) => {
      const res = await request.get(`${API}/search?q=a`);
      expect(res.status()).toBe(400);
    });

    test("GET /search?q=test returns 200 with correct shape", async ({
      request,
    }) => {
      const res = await request.get(`${API}/search?q=test`);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("projects");
      expect(body).toHaveProperty("tasks");
      expect(body).toHaveProperty("files");
      expect(body).toHaveProperty("clients");
      expect(Array.isArray(body.projects)).toBe(true);
      expect(Array.isArray(body.tasks)).toBe(true);
      expect(Array.isArray(body.files)).toBe(true);
      expect(Array.isArray(body.clients)).toBe(true);
    });
  });

  test.describe("API search results", () => {
    let projectId: string;
    const uniqueName = `SearchTarget-${Date.now()}`;

    test.beforeAll(async ({ request }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/projects`, {
        data: { name: uniqueName },
        headers: { "x-csrf-token": csrfToken },
      });
      if (res.ok()) {
        const body = await res.json();
        projectId = body.id;
      }
    });

    test.afterAll(async ({ request }) => {
      if (!projectId) return;
      const csrfToken = getCsrfToken();
      await request.delete(`${API}/projects/${projectId}`, {
        headers: { "x-csrf-token": csrfToken },
      });
    });

    test("searching by project name returns it in projects", async ({
      request,
    }) => {
      test.skip(!projectId, "No project available");
      const res = await request.get(
        `${API}/search?q=${encodeURIComponent(uniqueName.slice(0, 12))}`,
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.projects.some((p: { id: string }) => p.id === projectId)).toBe(true);
    });
  });

  test.describe("UI", () => {
    // A dedicated project created once for the UI tests so search returns
    // consistent, predictable results. Cleaned up after all UI tests finish.
    let uiProjectId: string;
    const uiProjectName = `UISearch-${Date.now()}`;

    test.beforeAll(async ({ request }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/projects`, {
        data: { name: uiProjectName },
        headers: { "x-csrf-token": csrfToken },
      });
      if (res.ok()) {
        const body = await res.json();
        uiProjectId = body.id;
      }
    });

    test.afterAll(async ({ request }) => {
      if (!uiProjectId) return;
      const csrfToken = getCsrfToken();
      await request.delete(`${API}/projects/${uiProjectId}`, {
        headers: { "x-csrf-token": csrfToken },
      });
    });

    test("Cmd+K opens the search palette", async ({ page }) => {
      await page.goto("/dashboard");
      await page.keyboard.press("Meta+k");
      await expect(
        page.getByPlaceholder(/search projects, tasks, files, people/i),
      ).toBeVisible({ timeout: 5000 });
    });

    test("typing 2+ chars shows results section headers", async ({ page }) => {
      test.skip(!uiProjectId, "No UI project available");

      await page.goto("/dashboard");
      await page.keyboard.press("Meta+k");
      const input = page.getByPlaceholder(
        /search projects, tasks, files, people/i,
      );
      await expect(input).toBeVisible({ timeout: 5000 });
      // Search for the prefix of the unique project name created in beforeAll
      await input.fill(uiProjectName.slice(0, 9));
      // Wait for debounce + fetch
      await expect(page.getByText(/projects/i).first()).toBeVisible({
        timeout: 5000,
      });
    });

    test("Escape closes the search palette", async ({ page }) => {
      await page.goto("/dashboard");
      await page.keyboard.press("Meta+k");
      await expect(
        page.getByPlaceholder(/search projects, tasks, files, people/i),
      ).toBeVisible({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await expect(
        page.getByPlaceholder(/search projects, tasks, files, people/i),
      ).not.toBeVisible();
    });
  });
});
