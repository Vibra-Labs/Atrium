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

  test("Canva URL in update renders iframe via mocked oEmbed response", async ({
    page,
    request,
  }) => {
    test.skip(!projectId, "No project available");

    const csrfToken = getCsrfToken();
    const canvaUrl = "https://www.canva.com/design/DAF0000TEST/view";
    await request.post(`${API}/updates?projectId=${projectId}`, {
      multipart: {
        content: `Check the board: ${canvaUrl}`,
      },
      headers: { "x-csrf-token": csrfToken },
    });

    // Mock the browser-side call to /api/embeds/resolve so we don't hit
    // Canva's real oEmbed endpoint from the test environment.
    await page.route("**/api/embeds/resolve*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          html: '<iframe src="https://www.canva.com/design/DAF0000TEST/view?embed" width="800" height="500"></iframe>',
          width: 800,
          height: 500,
          providerName: "Canva",
          title: "Test Canva Design",
        }),
      });
    });

    await page.goto(`/dashboard/projects/${projectId}`);
    await expect(
      page
        .locator('iframe[src*="canva.com/design/DAF0000TEST"]')
        .first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("oEmbed failure degrades to plain link (no iframe)", async ({
    page,
    request,
  }) => {
    test.skip(!projectId, "No project available");

    const csrfToken = getCsrfToken();
    const vimeoUrl = "https://vimeo.com/000000000";
    const content = `See: ${vimeoUrl}`;
    await request.post(`${API}/updates?projectId=${projectId}`, {
      multipart: { content },
      headers: { "x-csrf-token": csrfToken },
    });

    // Simulate an unresolvable oEmbed URL.
    await page.route("**/api/embeds/resolve*", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ message: "No oEmbed provider" }),
      });
    });

    await page.goto(`/dashboard/projects/${projectId}`);

    // The update itself must render, and the plain linkified URL must be
    // visible, but no Vimeo iframe should appear.
    const updateContainer = page
      .locator("p", { hasText: "See:" })
      .locator("..")
      .first();
    await expect(updateContainer).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('iframe[src*="player.vimeo.com"]'),
    ).not.toBeVisible();
  });
});
