import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Content Embeds", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    const csrfToken = getCsrfToken();
    const res = await request.post(`${API}/projects`, {
      data: { name: `Embeds Test Project ${Date.now()}` },
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

  test("YouTube URL in update shows embedded iframe", async ({
    page,
    request,
  }) => {
    test.skip(!projectId, "No project available");

    const csrfToken = getCsrfToken();
    await request.post(`${API}/updates?projectId=${projectId}`, {
      multipart: {
        content:
          "Watch this: https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
      headers: { "x-csrf-token": csrfToken },
    });

    await page.goto(`/dashboard/projects/${projectId}`);
    await expect(
      page.locator('iframe[src*="youtube.com/embed"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("plain text update shows no iframe inside its own container", async ({
    page,
    request,
  }) => {
    test.skip(!projectId, "No project available");

    const plainTextContent = "Just a plain text update with no embeddable URLs.";
    const csrfToken = getCsrfToken();
    await request.post(`${API}/updates?projectId=${projectId}`, {
      multipart: {
        content: plainTextContent,
      },
      headers: { "x-csrf-token": csrfToken },
    });

    await page.goto(`/dashboard/projects/${projectId}`);

    // Wait for the specific plain-text update to appear, then scope the
    // iframe assertion to its container. Using the parent of the <p> that
    // holds the content prevents false positives from iframe embeds inside
    // other updates on the same page (e.g. the YouTube update above).
    const updateContainer = page
      .locator("p", { hasText: plainTextContent })
      .locator("..")
      .first();

    await expect(updateContainer).toBeVisible({ timeout: 10000 });
    await expect(updateContainer.locator("iframe")).not.toBeVisible();
  });

  test("Loom URL in update shows embedded iframe", async ({
    page,
    request,
  }) => {
    test.skip(!projectId, "No project available");

    const csrfToken = getCsrfToken();
    await request.post(`${API}/updates?projectId=${projectId}`, {
      multipart: {
        content:
          "Recording: https://www.loom.com/share/abc123def456",
      },
      headers: { "x-csrf-token": csrfToken },
    });

    await page.goto(`/dashboard/projects/${projectId}`);
    await expect(
      page.locator('iframe[src*="loom.com/embed"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
