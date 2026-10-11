import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe.serial("Email preferences", () => {
  test.afterAll(async ({ request }) => {
    // Leave the shared test account with both emails on.
    await request.put(`${API}/email-preferences`, {
      data: { weeklyUpdateReminders: true, mondayDigest: true },
      headers: { "x-csrf-token": getCsrfToken() },
    });
  });

  test("both scheduled emails are on by default", async ({ request }) => {
    const res = await request.get(`${API}/email-preferences`);
    expect(res.ok()).toBe(true);
    expect(await res.json()).toEqual({ weeklyUpdateReminders: true, mondayDigest: true });
  });

  test("rejects a non-boolean value and unknown fields", async ({ request }) => {
    const headers = { "x-csrf-token": getCsrfToken() };
    expect((await request.put(`${API}/email-preferences`, { data: { mondayDigest: "nope" }, headers })).status()).toBe(400);
    expect((await request.put(`${API}/email-preferences`, { data: { marketing: true }, headers })).status()).toBe(400);
  });

  test("updating one switch leaves the other alone", async ({ request }) => {
    const res = await request.put(`${API}/email-preferences`, {
      data: { mondayDigest: false },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    expect(await res.json()).toEqual({ weeklyUpdateReminders: true, mondayDigest: false });
  });

  test("each email can be turned off from account settings and stays off", async ({ page, request }) => {
    await page.request.put(`${API}/email-preferences`, {
      data: { weeklyUpdateReminders: true, mondayDigest: true },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    await page.goto("/dashboard/settings/account#notifications");
    const monday = page.getByRole("checkbox", { name: /monday digest/i });
    const friday = page.getByRole("checkbox", { name: /friday reminder to send client updates/i });
    await expect(monday).toBeChecked({ timeout: 15000 });
    await expect(friday).toBeChecked();

    await monday.uncheck();
    await expect(page.getByText("Monday digest turned off")).toBeVisible();
    await friday.uncheck();
    await expect(page.getByText("Friday reminders turned off")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("checkbox", { name: /monday digest/i })).not.toBeChecked({ timeout: 15000 });
    await expect(page.getByRole("checkbox", { name: /friday reminder/i })).not.toBeChecked();
    expect(await (await request.get(`${API}/email-preferences`)).json()).toEqual({
      weeklyUpdateReminders: false,
      mondayDigest: false,
    });
  });
});
