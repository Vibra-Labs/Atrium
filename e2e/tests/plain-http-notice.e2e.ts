import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API: string = "http://localhost:3001/api";

// The notice only appears on a production install served over http://.
// Tests run in development, so this checks the flag is wired through and
// that the notice stays hidden; the production cases are unit-tested in
// apps/api/src/common/helpers/secure-cookies.spec.ts.
test.describe("Plain-HTTP notice (#94)", () => {
  test("settings reports insecureCookies as false outside production", async ({ request }) => {
    const res = await request.get(`${API}/settings`);
    expect(res.ok()).toBeTruthy();
    const body: { insecureCookies?: unknown } = await res.json();
    expect(body.insecureCookies).toBe(false);
  });

  test("dashboard does not show the notice outside production", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading").first()).toBeVisible();
    await expect(page.getByTestId("plain-http-notice")).toHaveCount(0);
  });

  test("dismissing the notice is saved on the workspace", async ({ request }) => {
    const headers: Record<string, string> = { "x-csrf-token": getCsrfToken() };
    try {
      const res = await request.patch(`${API}/settings`, { data: { plainHttpNoticeDismissed: true }, headers });
      expect(res.ok()).toBeTruthy();

      const body: { plainHttpNoticeDismissed?: unknown } = await (await request.get(`${API}/settings`)).json();
      expect(body.plainHttpNoticeDismissed).toBe(true);
    } finally {
      await request.patch(`${API}/settings`, { data: { plainHttpNoticeDismissed: false }, headers });
    }
  });

  test("rejects a non-boolean dismissal", async ({ request }) => {
    const res = await request.patch(`${API}/settings`, {
      data: { plainHttpNoticeDismissed: "yes" },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    expect(res.status()).toBe(400);
  });
});
