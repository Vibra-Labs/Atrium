import { test, expect } from "@playwright/test";
import type { APIResponse } from "@playwright/test";
import { createOwner, getCsrfTokenFromContext, inviteAndAcceptClient } from "./helpers";

const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";

async function ok(res: APIResponse): Promise<{ id: string }> {
  if (!res.ok()) throw new Error(`${res.url()} -> ${res.status()}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

test.describe("Portal project progress", () => {
  test.setTimeout(120000);

  test("project cards show task progress, ignoring cancelled tasks and votes", async ({ browser }) => {
    const { context: ownerCtx, page: owner } = await createOwner(browser, "progress-owner");
    const { clientEmail, password } = await inviteAndAcceptClient(browser, owner, "progress-client");
    const clients = await (await owner.request.get(`${API_URL}/api/clients?limit=100`)).json();
    const clientRow = (clients.data ?? clients).find(
      (m: { user: { email: string } }) => m.user.email === clientEmail,
    );
    const headers: Record<string, string> = { "x-csrf-token": await getCsrfTokenFromContext(ownerCtx) };

    const withTasks = await ok(await owner.request.post(`${API_URL}/api/projects`, {
      data: { name: "Progress E2E", clientUserIds: [clientRow.userId] },
      headers,
    }));
    await ok(await owner.request.post(`${API_URL}/api/projects`, {
      data: { name: "No Tasks E2E", clientUserIds: [clientRow.userId] },
      headers,
    }));

    // 2 done, 1 open, 1 cancelled, plus an open vote -> "2 of 3 tasks done".
    for (const status of ["done", "done", "open", "cancelled"]) {
      const task = await ok(await owner.request.post(`${API_URL}/api/tasks?projectId=${withTasks.id}`, {
        data: { title: `Task ${status}` },
        headers,
      }));
      if (status !== "open") {
        await ok(await owner.request.put(`${API_URL}/api/tasks/${task.id}`, {
          data: { status },
          headers,
        }));
      }
    }
    await ok(await owner.request.post(`${API_URL}/api/tasks?projectId=${withTasks.id}`, {
      data: { title: "Pick a palette", type: "decision", question: "Which palette?", options: [{ label: "Warm" }, { label: "Cool" }] },
      headers,
    }));

    const clientCtx = await browser.newContext({ storageState: undefined });
    const client = await clientCtx.newPage();
    await client.goto(`${WEB_URL}/login`);
    await client.getByLabel(/email/i).fill(clientEmail);
    await client.getByLabel(/password/i).fill(password);
    await client.getByRole("button", { name: /sign in/i }).click();
    await client.waitForURL(/\/portal/, { timeout: 15000 });
    await client.goto(`${WEB_URL}/portal/projects`);

    const card = client.locator("a", { hasText: "Progress E2E" });
    await expect(card.getByText("2 of 3 tasks done")).toBeVisible();
    await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "67");
    await expect(card.getByText(/^Updated /)).toBeVisible();

    // A project without tasks shows no bar rather than a misleading 0%.
    const empty = client.locator("a", { hasText: "No Tasks E2E" });
    await expect(empty).toBeVisible();
    await expect(empty.getByTestId("project-progress")).toHaveCount(0);

    await clientCtx.close();
    await ownerCtx.close();
  });
});
