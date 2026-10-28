import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createOwner, inviteAndAcceptClient, signIn } from "./helpers";

const WEB = "http://localhost:3000";

function trackRequests(page: Page, fragment: string): string[] {
  const urls: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes(fragment)) urls.push(req.url());
  });
  return urls;
}

test.describe("Login path", () => {
  test("/login makes no notification polling requests", async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    const polls = trackRequests(page, "/notifications/unread-count");
    await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    expect(polls).toHaveLength(0);
    await context.close();
  });

  test("dashboard polls unread-count", async ({ page }) => {
    const polls = trackRequests(page, "/notifications/unread-count");
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await expect.poll(() => polls.length).toBeGreaterThan(0);
  });

  test("/dashboard/settings lands on general workspace settings", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page).toHaveURL(/\/dashboard\/settings\/workspace$/);
  });

  test("owner and portal client log in to the right area", async ({ browser }) => {
    const owner = await createOwner(browser, "login-path");
    const client = await inviteAndAcceptClient(browser, owner.page, "login-path-client");

    const ownerLogin = await signIn(browser, owner.email, owner.password);
    await expect(ownerLogin.page).toHaveURL(/\/dashboard/);
    await ownerLogin.context.close();

    const clientLogin = await signIn(browser, client.clientEmail, client.password);
    await expect(clientLogin.page).toHaveURL(/\/portal\/projects/);
    await clientLogin.context.close();

    await owner.context.close();
  });
});
