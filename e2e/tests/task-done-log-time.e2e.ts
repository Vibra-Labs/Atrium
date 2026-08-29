import { test, expect } from "@playwright/test";
import { createTask, getOrCreateProject } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Log time prompt on task completion", () => {
  test("marking a task done prompts to log time linked to that task", async ({
    page,
    request,
  }) => {
    const projectId = await getOrCreateProject(request, "Time Tracking E2E");
    const title = `Done prompt ${Date.now().toString(36)}`;
    const taskId = await createTask(request, projectId, title, new Date());

    await page.goto(`/dashboard/projects/${projectId}?tab=tasks`);
    const noThanks = page.getByRole("button", { name: /^no thanks$/i });
    if (await noThanks.isVisible({ timeout: 2000 }).catch(() => false)) {
      await noThanks.click();
    }

    await page.getByTestId(`task-row-${taskId}`).click();
    await page.getByTestId("task-status-select").selectOption("done");

    await expect(
      page.getByRole("heading", { name: "Log time for this task" }),
    ).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("Time logged")).toBeVisible({ timeout: 10000 });

    const res = await request.get(
      `${API}/time-entries?projectId=${projectId}&limit=100`,
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const entries: { taskId: string | null }[] = Array.isArray(body)
      ? body
      : body.data;
    expect(entries.some((e) => e.taskId === taskId)).toBe(true);
  });
});
