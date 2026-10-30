import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  createPortalClientProject,
  disableWorkspaceEmail,
  enableWorkspaceEmail,
  latestMagicLinkToken,
} from "./helpers";

const WEB_URL = "http://localhost:3000";

interface LinkRequest {
  callbackURL: string;
  errorCallbackURL: string;
}

/** Presses "Email me a sign-in link" and returns the redirects the page asked Better Auth for. */
async function requestLink(page: Page, email: string): Promise<LinkRequest> {
  await page.getByLabel(/email/i).fill(email);
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith("/api/auth/sign-in/magic-link")),
    page.getByRole("button", { name: /email me a sign-in link/i }).click(),
  ]);
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible({ timeout: 15000 });
  return request.postDataJSON() as LinkRequest;
}

/** The emailed link: the web confirm page carrying the verify query Better Auth built. */
function emailedLink(token: string, link: LinkRequest): string {
  const query = new URLSearchParams({ token, ...link });
  return `${WEB_URL}/magic-link?${query.toString()}`;
}

/** Opens the emailed link as the email would: the confirm page, then its button. */
async function followLink(page: Page, email: string, link: LinkRequest): Promise<string> {
  const token: string = await latestMagicLinkToken(email);
  await page.goto(emailedLink(token, link));
  await page.getByRole("button", { name: /continue/i }).click();
  return token;
}

test.describe("Sign in with an emailed link", () => {
  // The button only shows when something can send email.
  test.beforeEach(async ({ request }) => {
    await enableWorkspaceEmail(request);
  });

  test.afterEach(async ({ request }) => {
    await disableWorkspaceEmail(request);
  });

  test("the login page asks the server whether sign-in links can be emailed", async ({ request }) => {
    const res = await request.get("http://localhost:3001/api/sign-in-options");
    expect(res.ok()).toBe(true);
    expect(await res.json()).toEqual({ magicLink: true });
  });
  test("a signed-out client following a deep link signs in by email and lands on that page", async ({
    browser,
  }) => {
    const setup = await createPortalClientProject(browser, "ml-deep", "Magic Link Project");
    const context = await browser.newContext({ storageState: undefined });
    const page: Page = await context.newPage();

    try {
      await page.goto(`${WEB_URL}/portal/projects/${setup.projectId}`);
      await expect(page).toHaveURL(/\/login\?next=/, { timeout: 15000 });

      const link: LinkRequest = await requestLink(page, setup.clientEmail);
      expect(link.callbackURL).toBe(`${WEB_URL}/portal/projects/${setup.projectId}`);

      await followLink(page, setup.clientEmail, link);
      await expect(page).toHaveURL(new RegExp(`/portal/projects/${setup.projectId}`), { timeout: 20000 });
      await expect(page.getByText("Magic Link Project").first()).toBeVisible({ timeout: 15000 });

      // The address is remembered for next time.
      await page.goto(`${WEB_URL}/login`);
      await expect(page.getByLabel(/email/i)).toHaveValue(setup.clientEmail);
    } finally {
      await context.close();
      await setup.close();
    }
  });

  test("a link works once; reusing it explains that it expired or was used", async ({ browser }) => {
    const setup = await createPortalClientProject(browser, "ml-once", "Single Use Project");
    const first = await browser.newContext({ storageState: undefined });
    const second = await browser.newContext({ storageState: undefined });

    try {
      const page: Page = await first.newPage();
      await page.goto(`${WEB_URL}/login`);
      const link: LinkRequest = await requestLink(page, setup.clientEmail);
      const token: string = await followLink(page, setup.clientEmail, link);
      await expect(page).toHaveURL(/\/portal/, { timeout: 20000 });

      const again: Page = await second.newPage();
      await again.goto(emailedLink(token, link));
      await again.getByRole("button", { name: /continue/i }).click();
      await expect(again).toHaveURL(/\/login/, { timeout: 20000 });
      await expect(again.getByText(/expired or was already used/i)).toBeVisible();
    } finally {
      await first.close();
      await second.close();
      await setup.close();
    }
  });

  test("an unknown address gets the same answer, so the form can't reveal who has an account", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page: Page = await context.newPage();
    const stranger = `ml-stranger-${Date.now()}@test.local`;

    await page.goto(`${WEB_URL}/login`);
    await requestLink(page, stranger);
    await expect(page.getByText(stranger)).toBeVisible();

    await context.close();
  });

  test("a link with no token says it is invalid", async ({ page }) => {
    await page.goto(`${WEB_URL}/magic-link`);
    await expect(page.getByRole("heading", { name: /invalid sign-in link/i })).toBeVisible();
  });
});
