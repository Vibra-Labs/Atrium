import { test, expect } from "@playwright/test";
import { createPortalClientProject, getCsrfToken, getOrCreateProject, openProjectTab } from "./helpers";
import type { PortalClientProject } from "./helpers";

const API = "http://localhost:3001/api";
const WEB = "http://localhost:3000";

test.describe("Files", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    projectId = await getOrCreateProject(request, "Files Test Project");
  });

  test("project files tab offers upload in the Add menu", async ({ page }) => {
    await openProjectTab(page, projectId, "files");
    await expect(page.getByRole("heading", { name: "Files", exact: true })).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Upload file", { exact: true })).toBeVisible();
  });

  test("portal client can open the Files tab of their project", async ({ browser }) => {
    test.setTimeout(120000);
    const portal: PortalClientProject = await createPortalClientProject(browser, "files", "Portal Files E2E");
    try {
      await portal.client.goto(`${WEB}/portal/projects/${portal.projectId}?tab=files`);
      // Clients may upload their own files; the staff-only Add menu is absent.
      await expect(portal.client.getByText("Upload File", { exact: true })).toBeVisible({ timeout: 15000 });
      await expect(portal.client.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
    } finally {
      await portal.close();
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
    // 1. Get current file count for the project
    const filesBeforeRes = await request.get(
      `${API}/files/project/${projectId}`,
    );
    expect(filesBeforeRes.ok()).toBeTruthy();
    const filesBefore = await filesBeforeRes.json();
    const countBefore = filesBefore.meta?.total ?? filesBefore.data?.length ?? 0;

    // 2. Post an update with a small text-file attachment
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

    // 3. Verify the file count increased
    const filesAfterRes = await request.get(
      `${API}/files/project/${projectId}`,
    );
    expect(filesAfterRes.ok()).toBeTruthy();
    const filesAfter = await filesAfterRes.json();
    const countAfter = filesAfter.meta?.total ?? filesAfter.data?.length ?? 0;
    expect(countAfter).toBeGreaterThan(countBefore);

    // 4. Verify the file is downloadable via the files endpoint
    const fileId = update.fileId as string;
    const downloadRes = await request.get(`${API}/files/${fileId}/download`);
    expect(downloadRes.ok()).toBeTruthy();
  });
});
