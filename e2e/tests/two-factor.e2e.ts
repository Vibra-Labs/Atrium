import { test, expect, request as playwrightRequest } from "@playwright/test";
import { generate as generateTotp } from "otplib";

async function totp(secret: string): Promise<string> {
  return generateTotp({ secret });
}

const API = "http://localhost:3001/api";

async function createUser() {
  const ctx = await playwrightRequest.newContext();
  const email = `2fa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
  const password = "TestPass123!";
  const res = await ctx.post(`${API}/onboarding/signup`, {
    data: { name: "2FA User", email, password, orgName: "2FA Test Org" },
  });
  if (!res.ok()) throw new Error(`signup failed: ${await res.text()}`);
  await ctx.get(`${API}/setup/status`);
  const cookies = await ctx.storageState();
  const csrf =
    cookies.cookies.find((c) => c.name === "csrf-token")?.value ?? "";
  await ctx.post(`${API}/setup/complete`, { headers: { "x-csrf-token": csrf } });
  return { ctx, email, password };
}

async function enableTwoFactor(
  ctx: Awaited<ReturnType<typeof createUser>>["ctx"],
  password: string,
) {
  const cookies = await ctx.storageState();
  const csrf =
    cookies.cookies.find((c) => c.name === "csrf-token")?.value ?? "";
  const enableRes = await ctx.post(`${API}/auth/two-factor/enable`, {
    data: { password },
    headers: { "x-csrf-token": csrf },
  });
  if (!enableRes.ok()) throw new Error(`enable failed: ${await enableRes.text()}`);
  const body = (await enableRes.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  const secret = new URL(body.totpURI).searchParams.get("secret") ?? "";
  const code = await totp(secret);
  const verifyRes = await ctx.post(`${API}/auth/two-factor/verify-totp`, {
    data: { code },
    headers: { "x-csrf-token": csrf },
  });
  if (!verifyRes.ok()) throw new Error(`verify failed: ${await verifyRes.text()}`);
  return { secret, backupCodes: body.backupCodes };
}

test.describe("Two-factor authentication", () => {
  test("opt-in: enable 2FA, log out, log back in with TOTP", async ({ browser }) => {
    const { email, password } = await createUser();

    const page = await browser.newPage();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/);

    await page.goto("/dashboard/settings/security");
    page.once("dialog", async (d) => d.accept(password));
    await page.getByRole("button", { name: /set up 2fa/i }).click();

    await page.getByText(/can't scan/i).click();
    const secret = (await page.locator("code").innerText()).trim();
    const code = await totp(secret);

    await page.getByPlaceholder("000000").fill(code);
    await page.getByRole("button", { name: /verify/i }).click();
    await expect(page.getByText(/save your recovery codes/i)).toBeVisible();
    await page.getByRole("button", { name: /i've saved these/i }).click();

    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/login\/2fa/);

    const nextCode = await totp(secret);
    await page.getByPlaceholder("000000").fill(nextCode);
    await page.getByRole("button", { name: /^verify$/i }).click();
    await page.waitForURL(/\/dashboard/);
  });

  test("trusted device skips challenge on next login", async ({ browser }) => {
    const { ctx, email, password } = await createUser();
    const { secret } = await enableTwoFactor(ctx, password);

    const page = await browser.newPage();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/login\/2fa/);
    await page.getByPlaceholder("000000").fill(await totp(secret));
    await page.getByLabel(/trust this device/i).check();
    await page.getByRole("button", { name: /^verify$/i }).click();
    await page.waitForURL(/\/dashboard/);

    const cookies = await page.context().cookies();
    await page.context().clearCookies();
    for (const c of cookies) {
      if (c.name.includes("trust")) {
        await page.context().addCookies([c]);
      }
    }
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
  });

  test("recovery code logs in once and cannot be reused", async ({ browser }) => {
    const { ctx, email, password } = await createUser();
    const { backupCodes } = await enableTwoFactor(ctx, password);
    const code = backupCodes[0];

    const page = await browser.newPage();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/login\/2fa/);
    await page.getByRole("button", { name: /use a recovery code/i }).click();
    await page.getByPlaceholder(/recovery code/i).fill(code);
    await page.getByRole("button", { name: /^verify$/i }).click();
    await page.waitForURL(/\/dashboard/);

    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/login\/2fa/);
    await page.getByRole("button", { name: /use a recovery code/i }).click();
    await page.getByPlaceholder(/recovery code/i).fill(code);
    await page.getByRole("button", { name: /^verify$/i }).click();
    await expect(page.getByText(/invalid/i)).toBeVisible();
  });

  test("org enforcement redirects unenrolled staff to /2fa/setup", async ({ browser }) => {
    const { ctx, email, password } = await createUser();

    const cookies = await ctx.storageState();
    const csrf =
      cookies.cookies.find((c) => c.name === "csrf-token")?.value ?? "";
    await ctx.put(`${API}/settings`, {
      data: { requireTwoFactor: true },
      headers: { "x-csrf-token": csrf },
    });

    const page = await browser.newPage();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.goto("/dashboard");
    await page.waitForURL(/\/2fa\/setup/);
    await expect(page.getByText(/two-factor authentication required/i)).toBeVisible();
  });

  test("clients (member role) are never forced to enroll", async () => {
    test.fixme(
      true,
      "Pending client-invite test helper — see e2e/tests/helpers.ts for the existing invitation pattern",
    );
  });
});
