import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Documents", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    const csrfToken = getCsrfToken();
    const res = await request.post(`${API}/projects`, {
      data: { name: "Document Test Project" },
      headers: { "x-csrf-token": csrfToken },
    });
    if (res.ok()) {
      const body = await res.json();
      projectId = body.id;
    }
  });

  test.describe("API", () => {
    test("create document via API", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();

      const boundary = "----DocBoundary" + Date.now();
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="projectId"',
        "",
        projectId,
        `--${boundary}`,
        'Content-Disposition: form-data; name="type"',
        "",
        "quote",
        `--${boundary}`,
        'Content-Disposition: form-data; name="title"',
        "",
        "E2E Test Quote",
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="test-quote.pdf"',
        "Content-Type: application/pdf",
        "",
        "fake pdf content for e2e test",
        `--${boundary}--`,
      ].join("\r\n");

      const res = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      expect(res.status()).toBe(201);
      const doc = await res.json();
      expect(doc.title).toBe("E2E Test Quote");
      expect(doc.type).toBe("quote");
      expect(doc.status).toBe("pending");
    });

    test("list documents by project via API", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const res = await request.get(`${API}/documents/project/${projectId}`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
    });

    test("get single document via API", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();

      // Create a document first
      const boundary = "----DocBoundary" + Date.now();
      const createBody = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="projectId"',
        "",
        projectId,
        `--${boundary}`,
        'Content-Disposition: form-data; name="type"',
        "",
        "contract",
        `--${boundary}`,
        'Content-Disposition: form-data; name="title"',
        "",
        "E2E Contract",
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="contract.pdf"',
        "Content-Type: application/pdf",
        "",
        "contract content",
        `--${boundary}--`,
      ].join("\r\n");

      const createRes = await request.post(`${API}/documents`, {
        data: createBody,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      const res = await request.get(`${API}/documents/${doc.id}`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.title).toBe("E2E Contract");
      expect(body.file).toBeTruthy();
    });

    test("delete document via API", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();

      const boundary = "----DocBoundary" + Date.now();
      const createBody = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="projectId"',
        "",
        projectId,
        `--${boundary}`,
        'Content-Disposition: form-data; name="type"',
        "",
        "nda",
        `--${boundary}`,
        'Content-Disposition: form-data; name="title"',
        "",
        "Doc to Delete",
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="delete-me.pdf"',
        "Content-Type: application/pdf",
        "",
        "delete content",
        `--${boundary}--`,
      ].join("\r\n");

      const createRes = await request.post(`${API}/documents`, {
        data: createBody,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      const res = await request.delete(`${API}/documents/${doc.id}`, {
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
    });

    test("document respond endpoint requires project assignment", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();

      // Create a document
      const boundary = "----DocBoundary" + Date.now();
      const createBody = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="projectId"',
        "",
        projectId,
        `--${boundary}`,
        'Content-Disposition: form-data; name="type"',
        "",
        "quote",
        `--${boundary}`,
        'Content-Disposition: form-data; name="title"',
        "",
        "Respond Test",
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="respond.pdf"',
        "Content-Type: application/pdf",
        "",
        "respond content",
        `--${boundary}--`,
      ].join("\r\n");

      const createRes = await request.post(`${API}/documents`, {
        data: createBody,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      // Try to respond as the owner (not a project client) — should fail
      const res = await request.post(`${API}/documents/${doc.id}/respond`, {
        data: { action: "accepted" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe("Dashboard UI", () => {
    test("project detail page shows documents section in files tab", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^files$/i }).click();
        await expect(page.getByText(/documents/i)).toBeVisible({ timeout: 5000 });
      }
    });

    test("upload document button is visible", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^files$/i }).click();
        await expect(page.getByText(/upload document/i)).toBeVisible({ timeout: 5000 });
      }
    });
  });
});
