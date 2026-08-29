import { test, expect } from "@playwright/test";
import { createTask, getCsrfToken, getOrCreateProject } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Time report", () => {
  test("lists projects in the filter and shows a per-task breakdown", async ({
    page,
    request,
  }) => {
    const projectName = "Time Tracking E2E";
    const projectId = await getOrCreateProject(request, projectName);
    const taskTitle = `Report task ${Date.now().toString(36)}`;
    const taskId = await createTask(request, projectId, taskTitle, new Date());

    const end = new Date();
    end.setDate(end.getDate() - 1);
    end.setHours(10, 0, 0, 0);
    const start = new Date(end);
    start.setHours(9, 0, 0, 0);
    const res = await request.post(`${API}/time-entries`, {
      data: {
        projectId,
        taskId,
        startedAt: start.toISOString(),
        endedAt: end.toISOString(),
        billable: true,
      },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    expect(res.ok()).toBeTruthy();

    await page.goto("/dashboard/reports/time");

    // Project dropdown is populated (regression: /projects?limit=200 was a 400)
    await expect(
      page.locator("select").first().locator("option", { hasText: projectName }),
    ).toHaveCount(1, { timeout: 15000 });

    await expect(page.getByRole("heading", { name: "By task" })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("cell", { name: taskTitle })).toBeVisible();
  });
});
