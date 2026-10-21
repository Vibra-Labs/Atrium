import { test, expect, type Request } from "@playwright/test";
import { getCsrfToken, getOrCreateProject, openProjectTab } from "./helpers";

const API = "http://localhost:3001/api";

// A valid 1x1 PNG, so the update is treated as an image attachment.
const PNG_1X1: Buffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Web render and request fixes", () => {
  test("the project page requests /labels once even though several components use them", async ({
    page,
    request,
  }) => {
    const projectId: string = await getOrCreateProject(request, "Render Fixes E2E");
    const labelRequests: string[] = [];
    page.on("request", (req: Request) => {
      if (req.method() === "GET" && /\/api\/labels(\?|$)/.test(req.url())) labelRequests.push(req.url());
    });

    await page.goto(`/dashboard/projects/${projectId}?tab=tasks`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("project-tab-tasks")).toBeVisible({ timeout: 15000 });

    expect(labelRequests).toHaveLength(1);
  });

  test("the running timer still ticks", async ({ page, request }) => {
    const projectId: string = await getOrCreateProject(request, "Render Fixes Timer E2E");
    await openProjectTab(page, projectId, "time");

    const noThanks = page.getByRole("button", { name: /^no thanks$/i });
    if (await noThanks.isVisible({ timeout: 2000 }).catch(() => false)) await noThanks.click();

    const startButton = page.locator("main").getByRole("button", { name: /^start timer$/i });
    await expect(startButton).toBeVisible({ timeout: 10000 });
    await startButton.click();

    const clock = page.locator("main span.font-mono").first();
    await expect(page.getByText(/running/i).first()).toBeVisible({ timeout: 10000 });
    const first: string = (await clock.textContent()) ?? "";
    await expect.poll(async () => (await clock.textContent()) ?? "", { timeout: 10000 }).not.toBe(first);

    // Leave the shared project without a running timer.
    await page.locator("main").getByRole("button", { name: /^stop timer$/i }).click();
    await page.getByRole("button", { name: /^stop$/i }).click();
    await expect(startButton).toBeVisible({ timeout: 10000 });
  });

  test("update images load lazily", async ({ page, request }) => {
    const projectId: string = await getOrCreateProject(request, "Render Fixes E2E");
    const res = await request.post(`${API}/updates?projectId=${projectId}`, {
      multipart: {
        content: "Update with an image for the lazy-loading check",
        attachment: { name: "pixel.png", mimeType: "image/png", buffer: PNG_1X1 },
      },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    expect(res.ok()).toBe(true);

    await openProjectTab(page, projectId, "updates");
    const image = page.locator('img[src*="/download"], img[src*="/attachment"]').first();
    await expect(image).toHaveAttribute("loading", "lazy", { timeout: 15000 });
    await expect(image).toHaveAttribute("decoding", "async");
  });
});
