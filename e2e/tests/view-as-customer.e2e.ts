import { test, expect } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";

async function createOwner(browser: Browser, prefix = "vac-owner"): Promise<{
  context: import("@playwright/test").BrowserContext;
  page: Page;
  email: string;
  password: string;
}> {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  const orgName = `${prefix} Org ${Date.now().toString(36)}`;
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const password = "ViewAs123!";

  const res = await page.request.post(`${API_URL}/api/onboarding/signup`, {
    data: { name: "VAC Owner", email, password, orgName },
  });
  if (!res.ok()) {
    throw new Error(`Owner signup failed (${res.status()}): ${await res.text()}`);
  }

  await page.goto(`${WEB_URL}/dashboard`, {
    waitUntil: "networkidle",
    timeout: 15000,
  });

  let url = page.url();
  if (url.includes("/login")) {
    await page.goto(`${WEB_URL}/login`);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(setup|dashboard)/, { timeout: 15000 });
    url = page.url();
  }

  if (url.includes("/setup")) {
    const cookies = await context.cookies();
    const csrfToken = cookies.find((c) => c.name === "csrf-token")?.value || "";
    await page.request.post(`${API_URL}/api/setup/complete`, {
      headers: { "x-csrf-token": csrfToken },
    });
    await page.goto(`${WEB_URL}/dashboard`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });
  }

  return { context, page, email, password };
}

async function inviteAndAcceptClient(
  browser: Browser,
  ownerPage: Page,
  prefix: string,
): Promise<{ clientEmail: string; clientName: string; password: string }> {
  const clientEmail = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const password = "Client123!";
  const clientName = "Test Client VAC";

  const inviteRes = await ownerPage.request.post(
    `${API_URL}/api/auth/organization/invite-member`,
    {
      data: { email: clientEmail, role: "member" },
      headers: { Origin: WEB_URL },
    },
  );
  if (!inviteRes.ok()) {
    throw new Error(`Invite failed (${inviteRes.status()}): ${await inviteRes.text()}`);
  }
  const inviteBody = await inviteRes.json();
  const invitationId: string = inviteBody?.id || inviteBody?.invitation?.id;
  if (!invitationId) {
    throw new Error(`Could not extract invitation id from: ${JSON.stringify(inviteBody)}`);
  }

  const clientCtx = await browser.newContext({ storageState: undefined });
  const clientPage = await clientCtx.newPage();
  await clientPage.goto(`${WEB_URL}/accept-invite?id=${invitationId}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await clientPage.waitForSelector("#name", { state: "visible", timeout: 30000 });
  await clientPage.waitForLoadState("networkidle", { timeout: 30000 });
  await clientPage.locator("#name").fill(clientName);
  await clientPage.locator("#email").fill(clientEmail);
  await clientPage.locator("#password").fill(password);
  await clientPage.getByRole("button", { name: /create account & join/i }).click();
  await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });
  await clientCtx.close();

  return { clientEmail, clientName, password };
}

test.describe("View as customer", () => {
  test.setTimeout(120000);
  test("owner can preview portal as a client and mutations are blocked", async ({
    browser,
  }) => {
    const { context: ownerCtx, page: ownerPage } = await createOwner(browser);
    const { clientEmail, clientName } = await inviteAndAcceptClient(
      browser,
      ownerPage,
      "vac-client",
    );

    await ownerPage.goto(`${WEB_URL}/dashboard/clients`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });
    await ownerPage.getByRole("button", { name: /^clients/i }).click();

    const clientRow = ownerPage
      .locator("div")
      .filter({ hasText: clientEmail })
      .first();
    await expect(clientRow).toBeVisible({ timeout: 10000 });

    const viewButton = clientRow.getByTitle("View as customer");
    await expect(viewButton).toBeVisible();

    const [previewPage] = await Promise.all([
      ownerCtx.waitForEvent("page"),
      viewButton.click(),
    ]);

    await previewPage.waitForLoadState("networkidle");
    await previewPage.waitForURL(/\/portal/, { timeout: 15000 });

    await expect(previewPage.getByText(/previewing as/i)).toBeVisible({
      timeout: 10000,
    });
    await expect(previewPage.getByText(clientName)).toBeVisible();
    await expect(previewPage.getByText(/read-only/i)).toBeVisible();
    await expect(
      previewPage.getByRole("button", { name: /exit preview/i }),
    ).toBeVisible();

    const mutationResult = await previewPage.evaluate(async () => {
      try {
        const res = await fetch("http://localhost:3001/api/clients/me/profile", {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-Preview-As": JSON.parse(
              window.sessionStorage.getItem("atrium:previewAs") || "{}",
            ).clientId || "",
          },
          body: JSON.stringify({ company: "should-not-save" }),
        });
        return { ok: res.ok, status: res.status };
      } catch (err) {
        return { error: String(err), ok: false, status: 0 };
      }
    });
    expect(mutationResult.ok).not.toBe(true);
    expect([401, 403]).toContain(mutationResult.status);

    await previewPage.getByRole("button", { name: /exit preview/i }).click();
    await previewPage
      .waitForURL(/\/dashboard\/clients/, { timeout: 5000 })
      .catch(() => {
        // Tab may have closed via window.close() instead of navigating.
      });

    await ownerCtx.close();
  });

  test("query params are stripped from URL after preview mode initializes", async ({
    browser,
  }) => {
    const { context: ownerCtx, page: ownerPage } = await createOwner(
      browser,
      "vac-strip",
    );
    const { clientEmail } = await inviteAndAcceptClient(
      browser,
      ownerPage,
      "vac-strip-client",
    );

    await ownerPage.goto(`${WEB_URL}/dashboard/clients`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });
    await ownerPage.getByRole("button", { name: /^clients/i }).click();

    const clientRow = ownerPage
      .locator("div")
      .filter({ hasText: clientEmail })
      .first();
    await expect(clientRow).toBeVisible({ timeout: 10000 });

    const viewButton = clientRow.getByTitle("View as customer");
    const [previewPage] = await Promise.all([
      ownerCtx.waitForEvent("page"),
      viewButton.click(),
    ]);

    await previewPage.waitForLoadState("networkidle");
    // After replaceState the URL must contain no previewAs/previewName/previewEmail
    // query params. The portal may internally redirect /portal -> /portal/projects.
    await expect(previewPage).toHaveURL(
      /^http:\/\/localhost:3000\/portal(\/.*)?$/,
      { timeout: 10000 },
    );
    expect(new URL(previewPage.url()).search).toBe("");

    await ownerCtx.close();
  });

  test("banner shows fallback name 'Client' when previewName param is absent", async ({
    browser,
  }) => {
    // Navigate directly to /portal?previewAs=<id> without previewName/previewEmail.
    // The provider must fall back to "Client" / "" instead of crashing.
    const { context: ownerCtx, page: ownerPage } = await createOwner(
      browser,
      "vac-fallback",
    );
    const { } = await inviteAndAcceptClient(
      browser,
      ownerPage,
      "vac-fallback-client",
    );

    // Fetch the client's userId directly via the API so we can craft the URL.
    const membersRes = await ownerPage.request.get(
      `${API_URL}/api/clients?page=1&limit=100`,
      { headers: { Origin: WEB_URL } },
    );
    const membersBody = await membersRes.json();
    const clientMember = (membersBody.data as Array<{
      role: string;
      userId: string;
    }>).find((m) => m.role === "member");

    if (!clientMember) {
      throw new Error("Could not find a member-role member to preview as");
    }

    // Open /portal with only previewAs — deliberately omit previewName/previewEmail.
    const portalPage = await ownerCtx.newPage();
    await portalPage.goto(
      `${WEB_URL}/portal?previewAs=${clientMember.userId}`,
      { waitUntil: "networkidle", timeout: 20000 },
    );

    await expect(portalPage.getByText(/previewing as/i)).toBeVisible({
      timeout: 10000,
    });
    // Fallback name must render as "Client", not throw or show undefined/null.
    await expect(portalPage.getByText("Client")).toBeVisible();

    await ownerCtx.close();
  });
});
