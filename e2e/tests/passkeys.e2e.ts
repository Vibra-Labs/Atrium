import { test, expect } from "@playwright/test";
import type { Browser, BrowserContext, CDPSession, Page } from "@playwright/test";
import { generate } from "otplib";
import { createOwner, inviteAndAcceptClient, latestMagicLinkToken, signIn } from "./helpers";

const WEB = "http://localhost:3000";
const API = "http://localhost:3001";

interface Authenticator {
  cdp: CDPSession;
  authenticatorId: string;
}

interface Credential {
  credentialId: string;
  isResidentCredential: boolean;
  rpId: string;
  privateKey: string;
  userHandle?: string;
  signCount: number;
}

/** Chrome's built-in virtual passkey device, with a fingerprint that always succeeds. */
async function virtualAuthenticator(page: Page): Promise<Authenticator> {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = (await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })) as { authenticatorId: string };
  return { cdp, authenticatorId };
}

async function credentials(a: Authenticator): Promise<Credential[]> {
  return ((await a.cdp.send("WebAuthn.getCredentials", { authenticatorId: a.authenticatorId })) as {
    credentials: Credential[];
  }).credentials;
}

/** Copies passkeys onto a device in another page, as if it were the same phone or laptop. */
async function copyPasskeys(from: Authenticator, to: Page): Promise<Authenticator> {
  const target: Authenticator = await virtualAuthenticator(to);
  for (const credential of await credentials(from)) {
    await target.cdp.send("WebAuthn.addCredential", { authenticatorId: target.authenticatorId, credential });
  }
  return target;
}

async function csrf(context: BrowserContext): Promise<string> {
  const find = async (): Promise<string | undefined> =>
    (await context.cookies()).find((c) => c.name === "csrf-token")?.value;
  if (!(await find())) await context.request.get(`${API}/api/two-factor/status`);
  return (await find()) ?? "";
}

function authPost(page: Page, path: string, data: unknown = {}) {
  return page.request.post(`${API}/api/auth${path}`, { data, headers: { Origin: WEB } });
}

async function status(page: Page): Promise<Record<string, unknown>> {
  return (await (await page.request.get(`${API}/api/two-factor/status`)).json()) as Record<string, unknown>;
}

/** Adds a passkey from Settings → Security, the way a person would. */
async function addPasskeyInSettings(page: Page, name: string): Promise<void> {
  await page.goto(`${WEB}/dashboard/settings/security`);
  await page.getByLabel(/name this passkey/i).fill(name);
  await page.getByRole("button", { name: /^add a passkey$/i }).click();
  await expect(page.getByRole("list", { name: /your passkeys/i }).getByText(name)).toBeVisible({ timeout: 15000 });
}

async function enableTotp(page: Page, password: string): Promise<string> {
  const res = await authPost(page, "/two-factor/enable", { password });
  expect(res.ok(), await res.text()).toBe(true);
  const secret: string = new URL(((await res.json()) as { totpURI: string }).totpURI).searchParams.get("secret") ?? "";
  const verify = await authPost(page, "/two-factor/verify-totp", { code: await generate({ secret }) });
  expect(verify.ok(), await verify.text()).toBe(true);
  return secret;
}

async function setRequirement(page: Page, required: boolean): Promise<void> {
  const res = await page.request.put(`${API}/api/two-factor/requirement`, {
    data: { required },
    headers: { "x-csrf-token": await csrf(page.context()) },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Invites an admin into the owner's workspace and signs them up and in, in a fresh context. */
async function addAdmin(browser: Browser, ownerPage: Page): Promise<{ page: Page; email: string; password: string }> {
  const email = `pk-admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const password = "Admin123!x";
  const invite = await authPost(ownerPage, "/organization/invite-member", { email, role: "admin" });
  expect(invite.ok(), await invite.text()).toBe(true);
  const invitationId: string = ((await invite.json()) as { id: string }).id;
  const context: BrowserContext = await browser.newContext({ storageState: undefined });
  const page: Page = await context.newPage();
  expect((await authPost(page, "/sign-up/email", { name: "PK Admin", email, password })).ok()).toBe(true);
  expect((await authPost(page, "/organization/accept-invitation", { invitationId })).ok()).toBe(true);
  return { page, email, password };
}

async function signOut(page: Page): Promise<void> {
  await authPost(page, "/sign-out");
}

test.describe("Passkeys", () => {
  test("add a passkey in settings, then sign in with it", async ({ browser }) => {
    const { page } = await createOwner(browser, "pk-signin");
    const device: Authenticator = await virtualAuthenticator(page);
    await addPasskeyInSettings(page, "Test laptop");
    expect(await credentials(device)).toHaveLength(1);

    await signOut(page);
    await page.goto(`${WEB}/login`);
    await page.getByRole("button", { name: /continue with a passkey/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 20000 });
    const s = await status(page);
    expect(s.pending).toBe(false);
    expect(s.passkeyCount).toBe(1);
  });

  test("an email link with a passkey lands on the code screen, and the passkey steps up and ends the old session", async ({ browser }) => {
    const { page, email, password } = await createOwner(browser, "pk-stepup");
    const device: Authenticator = await virtualAuthenticator(page);
    await addPasskeyInSettings(page, "Laptop");
    await enableTotp(page, password);
    // Workspace email so the login page offers a link.
    const settings = await page.request.patch(`${API}/api/settings`, {
      data: { emailProvider: "smtp", smtpHost: "127.0.0.1", smtpPort: 1, emailFrom: "e2e@test.local" },
      headers: { "x-csrf-token": await csrf(page.context()) },
    });
    expect(settings.ok()).toBe(true);

    const context: BrowserContext = await browser.newContext({ storageState: undefined });
    const visitor: Page = await context.newPage();
    await copyPasskeys(device, visitor);
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
    expect((await visitor.request.get(`${API}/api/projects`)).status()).toBe(403);

    const pendingCookies = await context.cookies();
    await visitor.getByRole("button", { name: /use a passkey/i }).click();
    await visitor.waitForURL(/\/dashboard/, { timeout: 20000 });
    expect((await visitor.request.get(`${API}/api/projects`)).status()).toBe(200);

    // The pending session the email link created is gone.
    const old: BrowserContext = await browser.newContext({ storageState: undefined });
    await old.addCookies(pendingCookies);
    expect((await old.request.get(`${API}/api/projects`)).status()).toBe(401);
    await old.close();
    await context.close();
  });

  test("a session waiting for its code cannot add a passkey", async ({ browser }) => {
    const { page, email, password } = await createOwner(browser, "pk-pending");
    // Signed in elsewhere before 2FA was turned on: that session becomes pending.
    const other = await signIn(browser, email, password);
    await enableTotp(page, password);
    const register = await other.page.request.get(`${API}/api/auth/passkey/generate-register-options`);
    expect(register.status()).toBe(403);
    expect(((await register.json()) as { code: string }).code).toBe("SECOND_FACTOR_REQUIRED");
    await other.context.close();
  });

  test("staff of a requiring workspace can set up 2FA with a passkey", async ({ browser }) => {
    const { page, password } = await createOwner(browser, "pk-enroll");
    await enableTotp(page, password);
    await setRequirement(page, true);
    const admin = await addAdmin(browser, page);
    await virtualAuthenticator(admin.page);

    await admin.page.goto(`${WEB}/dashboard`);
    await admin.page.waitForURL(/\/2fa\/setup/, { timeout: 20000 });
    await admin.page.getByLabel(/name this passkey/i).fill("Admin laptop");
    await admin.page.getByRole("button", { name: /^use a passkey$/i }).click();
    await expect(admin.page.getByText(/add a backup/i)).toBeVisible({ timeout: 15000 });
    await admin.page.getByRole("button", { name: /^continue$/i }).click();
    await admin.page.waitForURL(/\/dashboard/, { timeout: 20000 });
    expect((await admin.page.request.get(`${API}/api/projects`)).status()).toBe(200);
  });

  test("with a passkey, TOTP can be turned off, but the last passkey can't be removed in a requiring workspace", async ({ browser }) => {
    const { page, password } = await createOwner(browser, "pk-last");
    await virtualAuthenticator(page);
    const secret: string = await enableTotp(page, password);
    await addPasskeyInSettings(page, "Only key");
    await setRequirement(page, true);

    const off = await authPost(page, "/two-factor/disable", { password, code: await generate({ secret }) });
    expect(off.ok(), await off.text()).toBe(true);

    const list = (await (await page.request.get(`${API}/api/auth/passkey/list-user-passkeys`)).json()) as { id: string }[];
    const remove = await authPost(page, "/passkey/delete-passkey", { id: list[0].id });
    expect(remove.status()).toBe(403);
    expect(await remove.text()).toContain("last way to provide it");
  });

  test("clients can't add passkeys, and adding one never signs anyone in", async ({ browser }) => {
    const { page } = await createOwner(browser, "pk-client");
    const client = await inviteAndAcceptClient(browser, page, "pk-client-c");
    const session = await signIn(browser, client.clientEmail, client.password);
    const register = await session.page.request.get(`${API}/api/auth/passkey/generate-register-options`);
    expect(register.status()).toBe(403);
    await session.context.close();

    const createSession = await authPost(page, "/passkey/verify-registration", { response: {}, createSession: true });
    expect(createSession.status()).toBe(400);
  });

  test("nobody can remove someone else's passkey", async ({ browser }) => {
    const a = await createOwner(browser, "pk-owner-a");
    await virtualAuthenticator(a.page);
    await addPasskeyInSettings(a.page, "A's key");
    const list = (await (await a.page.request.get(`${API}/api/auth/passkey/list-user-passkeys`)).json()) as { id: string }[];
    const b = await createOwner(browser, "pk-owner-b");
    const res = await authPost(b.page, "/passkey/delete-passkey", { id: list[0].id });
    expect(res.status()).toBe(401);
  });

  test("an owner's reset removes a passkey-only admin's passkeys", async ({ browser }) => {
    const { page, password } = await createOwner(browser, "pk-reset");
    const secret: string = await enableTotp(page, password);
    await setRequirement(page, true);
    const admin = await addAdmin(browser, page);
    await virtualAuthenticator(admin.page);
    await admin.page.goto(`${WEB}/2fa/setup`);
    await admin.page.getByLabel(/name this passkey/i).fill("Admin phone");
    await admin.page.getByRole("button", { name: /^use a passkey$/i }).click();
    await expect(admin.page.getByText(/add a backup/i)).toBeVisible({ timeout: 15000 });

    await page.goto(`${WEB}/dashboard/settings/team`);
    await page.getByRole("button", { name: /turn off 2fa for pk admin/i }).click();
    await page.getByLabel(/your authenticator code/i).fill(await generate({ secret }));
    await page.getByRole("button", { name: /^turn off 2fa$/i }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10000 });

    const again: BrowserContext = await browser.newContext({ storageState: undefined });
    const p2: Page = await again.newPage();
    await p2.goto(`${WEB}/login`);
    await p2.getByLabel(/email/i).fill(admin.email);
    await p2.getByLabel(/password/i).fill(admin.password);
    await p2.getByRole("button", { name: /^sign in$/i }).click();
    await p2.waitForURL(/\/2fa\/setup/, { timeout: 20000 });
    expect((await status(p2)).passkeyCount).toBe(0);
    await again.close();
  });

  test("an owner whose only factor is a passkey confirms a reset with it", async ({ browser }) => {
    const { page } = await createOwner(browser, "pk-confirm");
    await virtualAuthenticator(page);
    await addPasskeyInSettings(page, "Owner key");
    const admin = await addAdmin(browser, page);
    await enableTotp(admin.page, admin.password);

    await page.goto(`${WEB}/dashboard/settings/team`);
    await page.getByRole("button", { name: /turn off 2fa for pk admin/i }).click();
    await expect(page.getByText(/confirm with your passkey/i)).toBeVisible();
    await page.getByRole("button", { name: /^turn off 2fa$/i }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15000 });
    expect((await admin.page.request.get(`${API}/api/projects`)).status()).toBe(401);
  });

  test("rename and remove a passkey", async ({ browser }) => {
    const { page } = await createOwner(browser, "pk-manage");
    await virtualAuthenticator(page);
    await addPasskeyInSettings(page, "Old name");
    await page.getByRole("button", { name: /rename old name/i }).click();
    await page.getByLabel(/new passkey name/i).fill("New name");
    await page.getByRole("button", { name: /^save$/i }).click();
    const list = page.getByRole("list", { name: /your passkeys/i });
    await expect(list.getByText("New name")).toBeVisible();
    await page.getByRole("button", { name: /remove new name/i }).click();
    await expect(list).toHaveCount(0, { timeout: 10000 });
    expect((await status(page)).passkeyCount).toBe(0);
  });
});
