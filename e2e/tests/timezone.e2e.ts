import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe.serial("Workspace timezone", () => {
  test.afterAll(async ({ request }) => {
    await request.patch(`${API}/settings`, { data: { timezone: null }, headers: { "x-csrf-token": getCsrfToken() } });
  });

  test("accepts an IANA zone, rejects a made-up one, and null clears it", async ({ request }) => {
    const headers = { "x-csrf-token": getCsrfToken() };
    const ok = await request.patch(`${API}/settings`, { data: { timezone: "Australia/Sydney" }, headers });
    expect(ok.ok(), await ok.text()).toBe(true);
    expect((await (await request.get(`${API}/settings`)).json()).timezone).toBe("Australia/Sydney");

    const bad = await request.patch(`${API}/settings`, { data: { timezone: "Mars/Olympus" }, headers });
    expect(bad.status()).toBe(400);

    const cleared = await request.patch(`${API}/settings`, { data: { timezone: null }, headers });
    expect(cleared.ok()).toBe(true);
    expect((await (await request.get(`${API}/settings`)).json()).timezone).toBeNull();
  });

  test("opening the dashboard fills in the browser's timezone when none is set", async ({ page, request }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 15000 });
    const expected: string = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    await expect.poll(async () => (await (await request.get(`${API}/settings`)).json()).timezone, { timeout: 10000 }).toBe(expected);
  });

  test("an explicit UTC choice is kept and not replaced by the browser's zone", async ({ page, request }) => {
    const headers = { "x-csrf-token": getCsrfToken() };
    await request.patch(`${API}/settings`, { data: { timezone: "UTC" }, headers });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState("networkidle");
    expect((await (await request.get(`${API}/settings`)).json()).timezone).toBe("UTC");
  });

  test("can be changed from workspace settings", async ({ page, request }) => {
    await page.goto("/dashboard/settings/workspace");
    const select = page.getByLabel("Workspace timezone");
    await expect(select).toBeVisible({ timeout: 15000 });
    await select.selectOption("Europe/Berlin");
    // The workspace page has several forms with a Save button; use the one this select lives in.
    await select.locator("xpath=ancestor::form[1]").getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("Configuration saved")).toBeVisible();
    expect((await (await request.get(`${API}/settings`)).json()).timezone).toBe("Europe/Berlin");
  });
});
