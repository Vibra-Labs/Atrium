import { test, expect, type APIRequestContext } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get or create a project for use in this test suite. The Free plan caps
 * orgs at 2 projects, so we can't always create a fresh one — we reuse
 * existing projects by name when present.
 */
async function getOrCreateProject(
  request: APIRequestContext,
  name: string,
): Promise<string> {
  // Look for an existing project with this name first
  const listRes = await request.get(`${API}/projects?limit=100`);
  if (listRes.ok()) {
    const list = await listRes.json();
    const items: { id: string; name: string }[] = Array.isArray(list)
      ? list
      : (list.data ?? []);
    const found = items.find((p) => p.name === name);
    if (found) return found.id;
  }

  // Otherwise create
  const csrfToken = getCsrfToken();
  const res = await request.post(`${API}/projects`, {
    data: { name },
    headers: { "x-csrf-token": csrfToken },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `Failed to create project (${res.status()}): ${body.slice(0, 200)}`,
    );
  }
  const body = await res.json();
  return body.id as string;
}

async function createBillableTimeEntry(
  request: APIRequestContext,
  projectId: string,
): Promise<string> {
  const csrfToken = getCsrfToken();
  // Create a 1-hour entry yesterday so it's safely in the past
  const end = new Date();
  end.setDate(end.getDate() - 1);
  end.setHours(10, 0, 0, 0);
  const start = new Date(end);
  start.setHours(9, 0, 0, 0);
  const res = await request.post(`${API}/time-entries`, {
    data: {
      projectId,
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
      description: "E2E billable work",
      billable: true,
    },
    headers: { "x-csrf-token": csrfToken },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.id as string;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Time tracking", () => {
  test("Start timer from time tab and stop it from the top-bar widget", async ({
    page,
    request,
  }) => {
    const projectId = await getOrCreateProject(request, "Time Tracking E2E");

    await page.goto(`/dashboard/projects/${projectId}?tab=time`);

    // Dismiss telemetry banner if present
    const noThanks = page.getByRole("button", { name: /^no thanks$/i });
    if (await noThanks.isVisible({ timeout: 2000 }).catch(() => false)) {
      await noThanks.click();
    }

    // The "Start timer" button appears twice on this page — once in the
    // top-bar widget (which opens a project picker dropdown) and once in
    // the Time tab itself (which starts immediately for this project).
    // Use the in-tab button so we don't have to navigate the picker.
    // The in-tab one sits next to the "Add entry" button.
    const inTabStart = page
      .locator("main")
      .getByRole("button", { name: /^start timer$/i })
      .last();
    await expect(inTabStart).toBeVisible({ timeout: 10000 });
    // Wait for the start-timer POST to complete so we know the entry exists
    const startResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/time-entries/start") &&
        res.request().method() === "POST",
      { timeout: 10000 },
    );
    await inTabStart.click();
    const startRes = await startResponse;
    expect(startRes.ok()).toBeTruthy();

    // The Time tab itself should now show a "running" entry row (TimeTab
    // re-fetches after starting). This is more reliable than waiting for
    // the top-bar widget's 30s poll.
    await expect(page.getByText(/running/i).first()).toBeVisible({
      timeout: 10000,
    });

    // Reload the page so the top-bar TimerWidget re-fetches /time-entries/running
    // and renders the running indicator with the "Stop timer" button.
    await page.reload();
    const stopButton = page.getByTitle("Stop timer");
    await expect(stopButton).toBeVisible({ timeout: 10000 });

    // Wait briefly so the entry has a non-trivial duration
    await page.waitForTimeout(1500);

    // Stop the timer via the top-bar widget
    const stopResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/time-entries/stop") &&
        res.request().method() === "POST",
      { timeout: 10000 },
    );
    await stopButton.click();
    const stopRes = await stopResponse;
    expect(stopRes.ok()).toBeTruthy();

    // After stopping, the widget should revert and "Stop timer" disappears.
    await expect(stopButton).toBeHidden({ timeout: 10000 });

    // Confirm an entry exists in the Time tab list.
    await page.goto(`/dashboard/projects/${projectId}?tab=time`);
    await expect(
      page.getByText(/No time logged on this project yet\./),
    ).toBeHidden({ timeout: 10000 });
    await expect(page.getByText(/E2E Test User/).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("Manual entry creates a row showing duration", async ({
    page,
    request,
  }) => {
    const projectId = await getOrCreateProject(request, "Time Tracking E2E");

    await page.goto(`/dashboard/projects/${projectId}?tab=time`);

    // Dismiss the telemetry consent banner if present so it doesn't
    // overlap or steal clicks.
    const noThanks = page.getByRole("button", { name: /^no thanks$/i });
    if (await noThanks.isVisible({ timeout: 2000 }).catch(() => false)) {
      await noThanks.click();
    }

    // Wait for the time-tab "Add entry" button (scoped to main content).
    const addEntry = page
      .locator("main")
      .getByRole("button", { name: /add entry/i });
    await expect(addEntry).toBeVisible({ timeout: 10000 });
    await addEntry.click();

    // Modal heading appears
    await expect(
      page.getByRole("heading", { name: /add time entry/i }),
    ).toBeVisible({ timeout: 5000 });

    // Submit via "Save" — and wait for the POST response so we know
    // the server accepted it before asserting on the list.
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/time-entries") &&
        res.request().method() === "POST",
      { timeout: 10000 },
    );
    await page.getByRole("button", { name: /^save$/i }).click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();

    // Reload to make sure the freshly-created entry shows up in the list
    // (avoids any client-side caching/race after the modal closes).
    await page.goto(`/dashboard/projects/${projectId}?tab=time`);

    // After submission a row showing 1 hour (1:00:00) should appear.
    await expect(page.getByText("1:00:00").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("Generate draft invoice from un-invoiced time entries", async ({
    page,
    request,
  }) => {
    const projectId = await getOrCreateProject(
      request,
      "Time Tracking E2E Invoices",
    );

    // Seed a billable entry via API so the generator has something to use
    await createBillableTimeEntry(request, projectId);

    await page.goto(`/dashboard/projects/${projectId}`);

    // Dismiss telemetry banner if present
    const noThanks = page.getByRole("button", { name: /^no thanks$/i });
    if (await noThanks.isVisible({ timeout: 2000 }).catch(() => false)) {
      await noThanks.click();
    }

    // Switch to the Invoices tab
    await page
      .locator("main")
      .getByRole("button", { name: /^invoices$/i })
      .first()
      .click();

    // Click "Generate from time" in the invoices section. The button text
    // collapses to "From time" on small viewports — match either.
    await page
      .getByRole("button", { name: /(generate from time|from time)/i })
      .click();

    // Modal title appears
    await expect(page.getByText(/generate invoice from time/i)).toBeVisible({
      timeout: 5000,
    });

    // Submit with default (no date filter, billable only)
    await page.getByRole("button", { name: /generate draft/i }).click();

    // A new invoice (INV-XXXX) should appear in the project's invoices list.
    await expect(page.getByText(/INV-/).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("Client (member role) is blocked from /api/time-entries", async ({
    request,
  }) => {
    test.fixme(
      true,
      "Member-role test helper not yet available; add when fixture exists",
    );
    // Placeholder — currently the e2e suite only authenticates as the org
    // owner. When a member-role fixture lands, this test should switch to
    // it and assert a 403 from GET /time-entries.
    const res = await request.get(`${API}/time-entries`);
    expect(res.status()).toBe(403);
  });
});
