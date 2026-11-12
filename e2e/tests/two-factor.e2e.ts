import { test, expect } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { generate } from "otplib";
import {
  createOwner,
  inviteAndAcceptClient,
  latestMagicLinkToken,
  openClientContact,
  signIn,
} from "./helpers";

const WEB = "http://localhost:3000";
const API = "http://localhost:3001";

interface Enabled {
  secret: string;
  backupCodes: string[];
}

async function totp(secret: string): Promise<string> {
  return generate({ secret });
}

/** The context's CSRF token. Any Atrium (non-auth) request sets the cookie, so make one if needed. */
async function csrf(context: BrowserContext): Promise<string> {
  const find = async (): Promise<string | undefined> =>
    (await context.cookies()).find((c) => c.name === "csrf-token")?.value;
  const existing: string | undefined = await find();
  if (existing) return existing;
  await context.request.get(`${API}/api/two-factor/status`);
  return (await find()) ?? "";
}

/** Gives the page's workspace an email provider (nothing listens), so the login page offers sign-in links. */
async function setWorkspaceEmail(page: Page, on: boolean): Promise<void> {
  const res = await page.request.patch(`${API}/api/settings`, {
    data: on
      ? { emailProvider: "smtp", smtpHost: "127.0.0.1", smtpPort: 1, emailFrom: "e2e@test.local" }
      : { emailProvider: null, smtpHost: null, smtpPort: null, emailFrom: null },
    headers: { "x-csrf-token": await csrf(page.context()) },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

/** A Better Auth call from the browser's cookies, with the Origin its CSRF check wants. */
function authPost(page: Page, path: string, data: unknown = {}) {
  return page.request.post(`${API}/api/auth${path}`, { data, headers: { Origin: WEB } });
}

async function userId(page: Page): Promise<string> {
  const res = await page.request.get(`${API}/api/auth/get-session`);
  return ((await res.json()) as { user: { id: string } }).user.id;
}

/** Turns on 2FA through the API for the page's signed-in user. */
async function enableTotp(page: Page, password: string): Promise<Enabled> {
  const res = await authPost(page, "/two-factor/enable", { password });
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as { totpURI: string; backupCodes: string[] };
  const secret: string = new URL(body.totpURI).searchParams.get("secret") ?? "";
  const verify = await authPost(page, "/two-factor/verify-totp", { code: await totp(secret) });
  expect(verify.ok(), await verify.text()).toBe(true);
  return { secret, backupCodes: body.backupCodes };
}

/** Password step only: lands on the code screen. */
async function passwordStep(browser: Browser, email: string, password: string, context?: BrowserContext) {
  const ctx: BrowserContext = context ?? (await browser.newContext({ storageState: undefined }));
  const page: Page = await ctx.newPage();
  await page.goto(`${WEB}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/login\/2fa/, { timeout: 20000 });
  await expect(page.getByRole("heading", { name: /two-factor authentication/i })).toBeVisible();
  return { context: ctx, page };
}

async function enterCode(page: Page, code: string): Promise<void> {
  await page.getByLabel(/^(code|recovery code)$/i).fill(code);
  await page.getByRole("button", { name: /^verify$/i }).click();
}

async function setRequirement(page: Page, required: boolean) {
  return page.request.put(`${API}/api/two-factor/requirement`, {
    data: { required },
    headers: { "x-csrf-token": await csrf(page.context()) },
  });
}

/** Invites `email` as an admin of the owner's workspace and signs them up and in, in a fresh context. */
async function addAdmin(browser: Browser, ownerPage: Page): Promise<{ page: Page; email: string; password: string }> {
  const email = `tf-admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const password = "Admin123!x";
  const invite = await authPost(ownerPage, "/organization/invite-member", { email, role: "admin" });
  expect(invite.ok(), await invite.text()).toBe(true);
  const invitationId: string = ((await invite.json()) as { id: string }).id;

  const context: BrowserContext = await browser.newContext({ storageState: undefined });
  const page: Page = await context.newPage();
  const signUp = await authPost(page, "/sign-up/email", { name: "TF Admin", email, password });
  expect(signUp.ok(), await signUp.text()).toBe(true);
  const accept = await authPost(page, "/organization/accept-invitation", { invitationId });
  expect(accept.ok(), await accept.text()).toBe(true);
  return { page, email, password };
}

test.describe("Two-factor authentication", () => {
  test("opt-in from settings, then password sign-in asks for a code", async ({ browser }) => {
    const { page, email, password } = await createOwner(browser, "tf-optin");
    await page.goto(`${WEB}/dashboard/settings/security`);
    await page.getByRole("button", { name: /turn on two-factor/i }).click();
    await page.getByRole("button", { name: /set up authenticator app/i }).click();
    // Accounts with a password confirm it.
    await page.getByLabel(/confirm your password/i).fill(password);
    await page.getByRole("button", { name: /set up authenticator app/i }).click();

    await expect(page.getByRole("list", { name: /recovery codes/i }).getByRole("listitem")).toHaveCount(10);
    const next = page.getByRole("button", { name: /^continue$/i });
    await expect(next).toBeDisabled();
    await page.getByLabel(/i saved these recovery codes/i).check();
    await next.click();

    const secret: string = (await page.getByTestId("totp-secret").textContent()) ?? "";
    await page.getByLabel(/6-digit code/i).fill(await totp(secret));
    await page.getByRole("button", { name: /turn on two-factor/i }).click();
    await expect(page.getByText(/^On\. Signing in asks for a code/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/10 recovery codes left/)).toBeVisible();

    const second = await passwordStep(browser, email, password);
    await enterCode(second.page, await totp(secret));
    await second.page.waitForURL(/\/dashboard/, { timeout: 20000 });
    await second.context.close();
  });

  test("password sign-in without a trusted device leaves no session", async ({ browser }) => {
    const { page, email, password } = await createOwner(browser, "tf-nosession");
    await enableTotp(page, password);
    const { page: challenged, context } = await passwordStep(browser, email, password);
    const session = await challenged.request.get(`${API}/api/auth/get-session`);
    expect(await session.json()).toBeNull();
    await challenged.goto(`${WEB}/dashboard`);
    await expect(challenged).toHaveURL(/\/login/);
    await context.close();
  });

  test("a trusted device skips the code next time", async ({ browser }) => {
    const { page, email, password } = await createOwner(browser, "tf-trust");
    const { secret } = await enableTotp(page, password);
    const { page: first, context } = await passwordStep(browser, email, password);
    await first.getByLabel(/trust this device for 30 days/i).check();
    await enterCode(first, await totp(secret));
    await first.waitForURL(/\/dashboard/, { timeout: 20000 });
    await authPost(first, "/sign-out");

    const again: Page = await context.newPage();
    await again.goto(`${WEB}/login`);
    await again.getByLabel(/email/i).fill(email);
    await again.getByLabel(/password/i).fill(password);
    await again.getByRole("button", { name: /^sign in$/i }).click();
    await again.waitForURL(/\/dashboard/, { timeout: 20000 });
    const projects = await again.request.get(`${API}/api/projects`);
    expect(projects.status()).toBe(200);
    await context.close();
  });

  test("a recovery code works once", async ({ browser }) => {
    const { page, email, password } = await createOwner(browser, "tf-recovery");
    const { backupCodes } = await enableTotp(page, password);

    const first = await passwordStep(browser, email, password);
    await first.page.getByRole("button", { name: /use a recovery code/i }).click();
    await enterCode(first.page, backupCodes[0]);
    await first.page.waitForURL(/\/dashboard/, { timeout: 20000 });
    const status = await first.page.request.get(`${API}/api/two-factor/status`);
    expect(((await status.json()) as { recoveryCodesLeft: number }).recoveryCodesLeft).toBe(9);
    await first.context.close();

    const second = await passwordStep(browser, email, password);
    await second.page.getByRole("button", { name: /use a recovery code/i }).click();
    await enterCode(second.page, backupCodes[0]);
    await expect(second.page.getByRole("alert")).toBeVisible();
    await expect(second.page).toHaveURL(/\/login\/2fa/);
    await second.context.close();
  });

  test("an email link with 2FA lands on the code screen and the API refuses until step-up", async ({ browser }) => {
    const { page, email, password } = await createOwner(browser, "tf-link");
    const { secret } = await enableTotp(page, password);
    await setWorkspaceEmail(page, true);
    try {
      const context: BrowserContext = await browser.newContext({ storageState: undefined });
      const visitor: Page = await context.newPage();
      await visitor.goto(`${WEB}/login`);
      await visitor.getByLabel(/email/i).fill(email);
      const [request] = await Promise.all([
        visitor.waitForRequest((r) => r.url().endsWith("/api/auth/sign-in/magic-link")),
        visitor.getByRole("button", { name: /email me a sign-in link/i }).click(),
      ]);
      const link = request.postDataJSON() as { callbackURL: string; errorCallbackURL: string };
      const token: string = await latestMagicLinkToken(email);
      await visitor.goto(`${WEB}/magic-link?${new URLSearchParams({ token, ...link }).toString()}`);
      await visitor.getByRole("button", { name: /continue/i }).click();
      await visitor.waitForURL(/\/login\/2fa/, { timeout: 20000 });

      const refused = await visitor.request.get(`${API}/api/projects`);
      expect(refused.status()).toBe(403);
      expect(((await refused.json()) as { code: string }).code).toBe("SECOND_FACTOR_REQUIRED");
      const invite = await authPost(visitor, "/organization/invite-member", { email: "x@test.local", role: "member" });
      expect(invite.status()).toBe(403);
      await visitor.goto(`${WEB}/dashboard`);
      await expect(visitor).toHaveURL(/\/login\/2fa/);
      // A step-up has no "trust this device".
      await expect(visitor.getByLabel(/trust this device/i)).toHaveCount(0);

      await enterCode(visitor, await totp(secret));
      await visitor.waitForURL(/\/dashboard/, { timeout: 20000 });
      expect((await visitor.request.get(`${API}/api/projects`)).status()).toBe(200);
      await context.close();
    } finally {
      await setWorkspaceEmail(page, false);
    }
  });

  test("turning 2FA on makes another signed-in browser pending at once", async ({ browser }) => {
    const { page, email, password } = await createOwner(browser, "tf-other");
    const other = await signIn(browser, email, password);
    expect((await other.page.request.get(`${API}/api/projects`)).status()).toBe(200);
    await enableTotp(page, password);
    const refused = await other.page.request.get(`${API}/api/projects`);
    expect(refused.status()).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe("SECOND_FACTOR_REQUIRED");
    await other.context.close();
  });

  test("changing the password keeps a verified session verified", async ({ browser }) => {
    const { page, password } = await createOwner(browser, "tf-change");
    await enableTotp(page, password);
    const change = await authPost(page, "/change-password", {
      currentPassword: password,
      newPassword: "Changed123!x",
      revokeOtherSessions: true,
    });
    expect(change.ok(), await change.text()).toBe(true);
    expect((await page.request.get(`${API}/api/projects`)).status()).toBe(200);
  });

  test("a requiring workspace sends staff without 2FA to setup, and never clients", async ({ browser }) => {
    const { page } = await createOwner(browser, "tf-require");
    const ownerPassword = "ViewAs123!";
    await enableTotp(page, ownerPassword);
    expect((await setRequirement(page, true)).ok()).toBe(true);

    const admin = await addAdmin(browser, page);
    const refused = await admin.page.request.get(`${API}/api/projects`);
    expect(refused.status()).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe("TWO_FACTOR_REQUIRED");
    expect((await admin.page.request.get(`${API}/api/auth/organization/list`)).status()).toBe(200);

    await admin.page.goto(`${WEB}/dashboard`);
    await admin.page.waitForURL(/\/2fa\/setup/, { timeout: 20000 });
    await admin.page.getByRole("button", { name: /set up authenticator app/i }).click();
    await admin.page.getByLabel(/confirm your password/i).fill(admin.password);
    await admin.page.getByRole("button", { name: /set up authenticator app/i }).click();
    await admin.page.getByLabel(/i saved these recovery codes/i).check();
    await admin.page.getByRole("button", { name: /^continue$/i }).click();
    const secret: string = (await admin.page.getByTestId("totp-secret").textContent()) ?? "";
    await admin.page.getByLabel(/6-digit code/i).fill(await totp(secret));
    await admin.page.getByRole("button", { name: /turn on two-factor/i }).click();
    await admin.page.waitForURL(/\/dashboard/, { timeout: 20000 });
    expect((await admin.page.request.get(`${API}/api/projects`)).status()).toBe(200);

    const client = await inviteAndAcceptClient(browser, page, "tf-require-client");
    const clientSession = await signIn(browser, client.clientEmail, client.password);
    await expect(clientSession.page).toHaveURL(/\/portal/);
    await clientSession.context.close();
  });

  test("the requirement needs the owner's own 2FA, and staff keep their last factor", async ({ browser }) => {
    const { page, password } = await createOwner(browser, "tf-rules");
    const early = await setRequirement(page, true);
    expect(early.status()).toBe(400);
    expect(((await early.json()) as { message: string }).message).toContain("your own account first");

    await enableTotp(page, password);
    expect((await setRequirement(page, true)).ok()).toBe(true);
    const disable = await authPost(page, "/two-factor/disable", { password });
    expect(disable.status()).toBe(403);
    expect(await disable.text()).toContain("requires two-factor authentication");
  });

  test("an owner resets an admin's 2FA from the team page", async ({ browser }) => {
    const { page, password } = await createOwner(browser, "tf-reset-admin");
    const { secret } = await enableTotp(page, password);
    expect((await setRequirement(page, true)).ok()).toBe(true);
    const admin = await addAdmin(browser, page);
    await enableTotp(admin.page, admin.password);

    await page.goto(`${WEB}/dashboard/settings/team`);
    await page.getByRole("button", { name: /turn off 2fa for tf admin/i }).click();
    await page.getByLabel(/your authenticator code/i).fill(await totp(secret));
    await page.getByRole("button", { name: /^turn off 2fa$/i }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10000 });

    // Signed out everywhere, and owes setup again at the next sign-in.
    expect((await admin.page.request.get(`${API}/api/projects`)).status()).toBe(401);
    const again = await browser.newContext({ storageState: undefined });
    const againPage: Page = await again.newPage();
    await againPage.goto(`${WEB}/login`);
    await againPage.getByLabel(/email/i).fill(admin.email);
    await againPage.getByLabel(/password/i).fill(admin.password);
    await againPage.getByRole("button", { name: /^sign in$/i }).click();
    await againPage.waitForURL(/\/2fa\/setup/, { timeout: 20000 });
    await again.close();
  });

  test("an admin cannot reset an owner, and nobody resets a member of another workspace", async ({ browser }) => {
    const { page } = await createOwner(browser, "tf-refuse");
    const admin = await addAdmin(browser, page);
    const ownerId: string = await userId(page);
    const byAdmin = await admin.page.request.delete(`${API}/api/two-factor/admin/${ownerId}`, {
      data: {},
      headers: { "x-csrf-token": await csrf(admin.page.context()) },
    });
    expect(byAdmin.status()).toBe(403);
    expect(((await byAdmin.json()) as { message: string }).message).toContain("Only an owner");

    // A client of this workspace who also joined a second one.
    const client = await inviteAndAcceptClient(browser, page, "tf-refuse-client");
    const second = await createOwner(browser, "tf-refuse-other");
    const invite = await authPost(second.page, "/organization/invite-member", { email: client.clientEmail, role: "member" });
    expect(invite.ok(), await invite.text()).toBe(true);
    const clientSession = await signIn(browser, client.clientEmail, client.password);
    const accept = await authPost(clientSession.page, "/organization/accept-invitation", {
      invitationId: ((await invite.json()) as { id: string }).id,
    });
    expect(accept.ok(), await accept.text()).toBe(true);
    await enableTotp(clientSession.page, client.password);

    await openClientContact(page, client.clientEmail);
    await page.getByRole("button", { name: /turn off 2fa for/i }).click();
    await page.getByRole("button", { name: /^turn off 2fa$/i }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("also belongs to another workspace");
    await clientSession.context.close();
  });

  test("an owner resets a client's 2FA from the contact page", async ({ browser }) => {
    const { page } = await createOwner(browser, "tf-reset-client");
    const client = await inviteAndAcceptClient(browser, page, "tf-reset-client-c");
    const clientSession = await signIn(browser, client.clientEmail, client.password);
    await enableTotp(clientSession.page, client.password);

    await openClientContact(page, client.clientEmail);
    await expect(page.getByText("2FA on")).toBeVisible();
    await page.getByRole("button", { name: /turn off 2fa for/i }).click();
    await page.getByRole("button", { name: /^turn off 2fa$/i }).click();
    await expect(page.getByText("2FA on")).toHaveCount(0, { timeout: 10000 });
    expect((await clientSession.page.request.get(`${API}/api/projects`)).status()).toBe(401);
    await clientSession.context.close();
  });
});
