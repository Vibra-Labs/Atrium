/**
 * The public demo: one click into a working workspace, no signup.
 *
 * These run without the suite's stored session on purpose — the whole point is
 * that a stranger with no account gets in.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:3001";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("public demo", () => {
  test("enters the demo as the agency and renders seeded data", async ({ page }) => {
    await page.goto("/demo");

    await page.waitForURL("**/dashboard", { timeout: 20000 });
    await expect(page.getByTestId("demo-banner")).toBeVisible();
    await expect(page.getByText(/resets in (\d+ minutes?|under a minute)/i)).toBeVisible();
    // By role, not by text: the seeded project's name is on the dashboard
    // several times over — a card, a link, a task-due line, and a responsive
    // duplicate that is hidden at this viewport, which is what a plain text
    // match lands on first.
    await expect(
      page.getByRole("link", { name: "Lumen Coffee — Brand refresh" }).first(),
    ).toBeVisible();
  });

  test("creates a project inside the demo, because a read-only demo is worse than none", async ({
    page,
  }) => {
    await page.goto("/demo");
    await page.waitForURL("**/dashboard", { timeout: 20000 });

    const name = `Demo visitor project ${Date.now()}`;
    const response = await page.request.post(`${API}/api/projects`, {
      data: { name, description: "Made by a demo visitor" },
      headers: { "x-csrf-token": await csrfToken(page) },
    });

    expect(response.ok()).toBe(true);
  });

  test("posts a text-only update, which the upload fence used to refuse", async ({ page }) => {
    // The composer built a FormData whether or not a file was attached, so the
    // demo's multipart fence answered the product's headline action with
    // "Uploads are turned off in the demo." Asserted against the real endpoint
    // because the bug lived in the seam between the client and the guard,
    // which is exactly what no unit test on either side could see.
    await page.goto("/demo");
    await page.waitForURL("**/dashboard", { timeout: 20000 });

    const projects = await page.request.get(`${API}/api/projects`);
    const projectId: string = (await projects.json()).data[0].id;

    const response = await page.request.post(`${API}/api/updates?projectId=${projectId}`, {
      data: { content: "Posted by a demo visitor" },
      headers: { "x-csrf-token": await csrfToken(page) },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(201);
  });

  test("refuses a file upload with the demo's own wording", async ({ page }) => {
    await page.goto("/demo");
    await page.waitForURL("**/dashboard", { timeout: 20000 });

    const response = await page.request.post(`${API}/api/files/upload`, {
      multipart: {
        file: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("x") },
        projectId: "whatever",
      },
      headers: { "x-csrf-token": await csrfToken(page) },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(403);
    expect(await response.text()).toContain("Uploads are turned off in the demo.");
  });

  test("enters as a client and lands on the portal", async ({ page }) => {
    await page.goto("/demo/client");

    // /portal is not a page: the portal's landing is its project list, and
    // every client arrives via that redirect. The entry's callbackURL is
    // /portal, so the hop is part of the flow being asserted.
    await page.waitForURL("**/portal/projects", { timeout: 20000 });
    await expect(page.getByTestId("demo-banner")).toBeVisible();
    // The client entry exists so the portal is writable; preview mode is not.
    await expect(page.getByText(/Lumen Coffee/).first()).toBeVisible();
  });

  test("the entry endpoint is not a GET, so link previews cannot spend sessions", async ({
    request,
  }) => {
    const response = await request.get(`${API}/api/demo/enter`, { failOnStatusCode: false });
    expect(response.status()).toBe(404);
  });
});

async function csrfToken(page: import("@playwright/test").Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === "csrf-token")?.value ?? "";
}
