import { test, expect } from "@playwright/test";
import type { APIRequestContext, Browser, BrowserContext, Page, PlaywrightWorkerArgs } from "@playwright/test";
import { createHash, randomBytes } from "crypto";

const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";
const REDIRECT_URI = "http://localhost:9999/callback";

interface Flow { clientId: string; authorizeUrl: string; verifier: string }

/**
 * Better Auth's origin-check middleware requires an Origin header on any
 * cookie-bearing POST to /api/auth/*. The default `request` fixture reuses
 * the signed-in owner's storageState cookies, which trips that check for a
 * real MCP client — which never holds the owner's session cookie in the
 * first place. Register and exchange calls must go through a cookie-less
 * context instead, matching how a real OAuth client talks to these endpoints.
 */
async function anonymousContext(
  playwright: PlaywrightWorkerArgs["playwright"],
): Promise<APIRequestContext> {
  return playwright.request.newContext({ storageState: { cookies: [], origins: [] } });
}

async function startFlow(request: APIRequestContext, name: string): Promise<Flow> {
  const reg = await request.post(`${API_URL}/api/auth/mcp/register`, {
    data: { client_name: name, redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none" },
  });
  expect(reg.ok()).toBeTruthy();
  const clientId: string = (await reg.json()).client_id;
  const verifier: string = randomBytes(32).toString("base64url");
  const challenge: string = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access", state: "e2e",
    code_challenge: challenge, code_challenge_method: "S256",
  });
  return { clientId, verifier, authorizeUrl: `${API_URL}/api/auth/mcp/authorize?${query}` };
}

/** Nothing listens on the redirect URI, so capture the navigation instead of loading it. */
async function captureCallback(page: Page, action: () => Promise<void>): Promise<URL> {
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().startsWith(REDIRECT_URI), { timeout: 15_000 }),
    action(),
  ]);
  return new URL(request.url());
}

async function exchange(request: APIRequestContext, flow: Flow, code: string): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/mcp/token`, {
    form: {
      grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI,
      client_id: flow.clientId, code_verifier: flow.verifier,
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).access_token;
}

const INITIALIZE = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } },
};

function bearer(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
}

/** Calls get_workspace with an OAuth token and returns the tool's text. */
async function getWorkspace(request: APIRequestContext, token: string): Promise<string> {
  const res = await request.post(`${API_URL}/api/mcp`, {
    headers: bearer(token),
    data: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_workspace", arguments: {} } },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.error, JSON.stringify(body)).toBeUndefined();
  return body.result.content[0].text as string;
}

function uniq(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** A fresh owner with their own workspace, signed in inside a new browser context. */
async function signUpOwner(browser: Browser, orgName: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const res = await page.request.post(`${API_URL}/api/onboarding/signup`, {
    data: { name: "OAuth Owner", email: `${uniq("oauth-owner")}@test.local`, password: "OAuthOwner123!", orgName },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return { context, page };
}

test.describe("MCP OAuth login", () => {
  test("discovery documents are served at the origin root", async ({ request }) => {
    const pr = await request.get(`${API_URL}/.well-known/oauth-protected-resource`);
    expect((await pr.json()).resource).toContain("/api/mcp");
    const as = await request.get(`${API_URL}/.well-known/oauth-authorization-server`);
    expect((await as.json()).registration_endpoint).toContain("/api/auth/mcp/register");
  });

  test("consent → token → MCP call → disconnect", async ({ page, playwright }) => {
    test.setTimeout(75_000);
    const name = `E2E App ${Date.now()}`;
    const bare = await anonymousContext(playwright);
    try {
      const flow = await startFlow(bare, name);

      await page.goto(flow.authorizeUrl);
      await expect(page).toHaveURL(/\/oauth\/consent/);
      await expect(page.getByRole("heading", { name: `Connect ${name} to Atrium` })).toBeVisible();
      // The name is attacker-chosen; the destination is the part worth checking.
      await expect(page.getByText("This request comes from an app on this computer.")).toBeVisible();
      await expect(
        page.getByText("Only approve if you started this connection yourself."),
      ).toBeVisible();

      const callback = await captureCallback(page, () => page.getByRole("button", { name: "Allow" }).click());
      expect(callback.searchParams.get("state")).toBe("e2e");
      const token = await exchange(bare, flow, callback.searchParams.get("code")!);

      const headers = bearer(token);
      const ok = await bare.post(`${API_URL}/api/mcp`, { headers, data: INITIALIZE });
      expect(ok.status()).toBe(200);

      // A real tool call, not just the handshake
      expect(await getWorkspace(bare, token)).toContain("E2E Test Org");

      // The OAuth token must not work on the REST API
      const rest = await bare.get(`${API_URL}/api/projects`, { headers });
      expect(rest.status()).toBe(401);

      // Listed under Connected apps; disconnecting kills the token
      await page.goto("/dashboard/settings/api-keys");
      const row = page.getByRole("row").filter({ hasText: name });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.getByRole("button", { name: /disconnect/i }).click();
      await page.getByRole("button", { name: "Disconnect" }).last().click();
      await expect(page.getByText(/app disconnected/i)).toBeVisible({ timeout: 5000 });

      await expect
        .poll(async () => (await bare.post(`${API_URL}/api/mcp`, { headers, data: INITIALIZE })).status(),
          { timeout: 40_000, intervals: [2_000] })
        .toBe(401);
    } finally {
      await bare.dispose();
    }
  });

  test("Deny returns access_denied to the client", async ({ page, playwright }) => {
    const bare = await anonymousContext(playwright);
    try {
      const flow = await startFlow(bare, `E2E Deny ${Date.now()}`);
      await page.goto(flow.authorizeUrl);
      const callback = await captureCallback(page, () => page.getByRole("button", { name: "Deny" }).click());
      expect(callback.searchParams.get("error")).toBe("access_denied");
      expect(callback.searchParams.get("code")).toBeNull();
    } finally {
      await bare.dispose();
    }
  });

  test("a signed-out user is sent to login and lands on consent after signing in", async ({ browser, request, playwright }) => {
    const name = `E2E Login ${Date.now()}`;
    const bare = await anonymousContext(playwright);
    try {
      const flow = await startFlow(bare, name);
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      try {
        const page = await context.newPage();

        await page.goto(flow.authorizeUrl);
        await expect(page).toHaveURL(/\/login\?.*client_id=/);

        // A dedicated account, created the way e2e/global-setup.ts creates the main one.
        const email = `oauth-login-${Date.now()}@test.local`;
        const password = "OAuthLogin123!";
        const signup = await request.post(`${API_URL}/api/onboarding/signup`, {
          data: { name: "OAuth Login", email, password, orgName: "OAuth Login Org" },
        });
        expect(signup.ok()).toBeTruthy();

        await page.getByLabel(/email/i).fill(email);
        await page.getByLabel(/password/i).fill(password);
        await page.getByRole("button", { name: /sign in|log in/i }).click();

        await expect(page).toHaveURL(/\/oauth\/consent/, { timeout: 15_000 });
        await expect(page.getByRole("heading", { name: `Connect ${name} to Atrium` })).toBeVisible();
      } finally {
        await context.close();
      }
    } finally {
      await bare.dispose();
    }
  });

  test("the workspace picker binds the connection to the workspace chosen", async ({ browser, playwright }) => {
    test.setTimeout(60_000);
    const first = `Picker One ${Date.now().toString(36)}`;
    const second = `Picker Two ${Date.now().toString(36)}`;
    const owner = await signUpOwner(browser, first);
    const bare = await anonymousContext(playwright);
    try {
      const created = await owner.page.request.post(`${API_URL}/api/auth/organization/create`, {
        data: { name: second, slug: uniq("picker-two") },
        headers: { Origin: WEB_URL },
      });
      expect(created.status(), await created.text()).toBe(200);

      const flow = await startFlow(bare, `E2E Picker ${Date.now()}`);
      await owner.page.goto(flow.authorizeUrl);
      await expect(owner.page).toHaveURL(/\/oauth\/consent/);

      const picker = owner.page.getByLabel("Workspace");
      await expect(picker).toBeVisible();
      await expect(picker.locator("option")).toHaveCount(2);
      await expect(picker).toContainText(first);
      await expect(picker).toContainText(second);
      await picker.selectOption({ label: second });
      await expect(owner.page.getByText(`in ${second}, acting as you`)).toBeVisible();

      const callback = await captureCallback(owner.page, () =>
        owner.page.getByRole("button", { name: "Allow" }).click());
      const token = await exchange(bare, flow, callback.searchParams.get("code")!);

      const workspace = await getWorkspace(bare, token);
      expect(workspace).toContain(second);
      expect(workspace).not.toContain(first);
    } finally {
      await bare.dispose();
      await owner.context.close();
    }
  });

  test("a portal client can only Deny", async ({ browser, playwright }) => {
    test.setTimeout(60_000);
    const owner = await signUpOwner(browser, `Deny Only ${Date.now().toString(36)}`);
    const clientEmail = `${uniq("oauth-client")}@test.local`;
    const invite = await owner.page.request.post(`${API_URL}/api/auth/organization/invite-member`, {
      data: { email: clientEmail, role: "member" },
      headers: { Origin: WEB_URL },
    });
    expect(invite.ok(), await invite.text()).toBe(true);
    const inviteBody = await invite.json();
    const invitationId: string = inviteBody?.id || inviteBody?.invitation?.id || inviteBody?.data?.id;
    expect(invitationId).toBeTruthy();
    await owner.context.close();

    const client = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const bare = await anonymousContext(playwright);
    try {
      const page = await client.newPage();
      const signup = await page.request.post(`${API_URL}/api/auth/sign-up/email`, {
        data: { name: "OAuth Client", email: clientEmail, password: "OAuthClient123!" },
        headers: { Origin: WEB_URL },
      });
      expect(signup.ok(), await signup.text()).toBe(true);
      const accept = await page.request.post(`${API_URL}/api/auth/organization/accept-invitation`, {
        data: { invitationId },
        headers: { Origin: WEB_URL },
      });
      expect(accept.ok(), await accept.text()).toBe(true);

      const flow = await startFlow(bare, `E2E Client ${Date.now()}`);
      await page.goto(flow.authorizeUrl);
      await expect(page).toHaveURL(/\/oauth\/consent/);
      await expect(page.getByText("Only workspace owners and admins can connect AI assistants.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);

      const callback = await captureCallback(page, () => page.getByRole("button", { name: "Deny" }).click());
      expect(callback.searchParams.get("error")).toBe("access_denied");
    } finally {
      await bare.dispose();
      await client.close();
    }
  });
});
