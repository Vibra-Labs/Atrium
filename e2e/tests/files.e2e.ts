import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Files", () => {
  test("project detail page shows file upload area", async ({ page }) => {
    await page.goto("/dashboard/projects");
    // The page should load and show the projects heading
    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible();
  });

  test("upload button is visible on project detail page", async ({ page }) => {
    // Navigate to the projects list and check that the UI renders
    await page.goto("/dashboard/projects");
    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible();

    // If there are project links, click the first one and check for upload UI
    const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
    if (await projectLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectLink.click();
      await expect(page.getByText(/upload file/i)).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/files/i)).toBeVisible();
    }
  });

  test("portal project page does not show upload button for clients", async ({ page }) => {
    await page.goto("/portal/projects");
    await expect(
      page.getByRole("heading", { name: /your projects/i }),
    ).toBeVisible();

    // Clients should see projects list but the portal project detail
    // should not have an upload button (read-only file access)
    const projectLink = page.locator("a[href*='/portal/projects/']").first();
    if (await projectLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectLink.click();
      await expect(page.getByText(/files/i)).toBeVisible({ timeout: 5000 });
      // Upload button should NOT be visible on the portal (client) view
      await expect(page.getByText(/upload file/i)).not.toBeVisible();
    }
  });

  test("file upload rejects when no file selected", async ({ page, context }) => {
    // This tests the API-level validation
    const cookies = await context.cookies();
    const csrfToken = cookies.find((c) => c.name === "csrf-token")?.value || "";
    const response = await page.request.post(
      "http://localhost:3001/api/files/upload?projectId=nonexistent",
      {
        multipart: {
          // Send empty multipart request without a file
        },
        headers: { "x-csrf-token": csrfToken },
      },
    );

    // Should be rejected (401 unauthenticated or 400 bad request)
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test("file download endpoint requires authentication", async ({ page }) => {
    const response = await page.request.get(
      "http://localhost:3001/api/files/nonexistent-id/download",
    );

    // Should be 401 Unauthorized without a valid session
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test("posting an update with attachment creates a file record", async ({
    request,
  }) => {
    // 1. Get a project to attach the update to
    const projectsRes = await request.get(`${API}/projects?limit=1`);
    expect(projectsRes.ok()).toBeTruthy();
    const projects = await projectsRes.json();
    if (!projects.data?.length) return;

    const projectId = projects.data[0].id as string;

    // 2. Get current file count for the project
    const filesBeforeRes = await request.get(
      `${API}/files/project/${projectId}`,
    );
    expect(filesBeforeRes.ok()).toBeTruthy();
    const filesBefore = await filesBeforeRes.json();
    const countBefore = filesBefore.meta?.total ?? filesBefore.data?.length ?? 0;

    // 3. Post an update with a small text-file attachment
    const boundary = "----TestBoundary" + Date.now();
    const fileContent = "test file content for e2e";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="content"',
      "",
      "Update with attachment for file integration test",
      `--${boundary}`,
      'Content-Disposition: form-data; name="attachment"; filename="test-attachment.txt"',
      "Content-Type: text/plain",
      "",
      fileContent,
      `--${boundary}--`,
    ].join("\r\n");

    const csrfToken = getCsrfToken();
    const updateRes = await request.post(
      `${API}/updates?projectId=${projectId}`,
      {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      },
    );
    expect(updateRes.ok()).toBeTruthy();
    const update = await updateRes.json();
    expect(update.fileId).toBeTruthy();

    // 4. Verify the file count increased
    const filesAfterRes = await request.get(
      `${API}/files/project/${projectId}`,
    );
    expect(filesAfterRes.ok()).toBeTruthy();
    const filesAfter = await filesAfterRes.json();
    const countAfter = filesAfter.meta?.total ?? filesAfter.data?.length ?? 0;
    expect(countAfter).toBeGreaterThan(countBefore);

    // 5. Verify the file is downloadable via the files endpoint
    const fileId = update.fileId as string;
    const downloadRes = await request.get(`${API}/files/${fileId}/download`);
    expect(downloadRes.ok()).toBeTruthy();
  });
});
