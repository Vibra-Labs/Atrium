import { test, expect } from "@playwright/test";
import { createOwner, getCsrfTokenFromContext, inviteAndAcceptClient, openClientContact } from "./helpers";

const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";

test.describe("View as customer", () => {
  test.setTimeout(120000);

  test("previewing as a client shows only that client's projects", async ({ browser }) => {
    const { context: ownerCtx, page: ownerPage } = await createOwner(browser, "vac-scope");
    const { clientEmail } = await inviteAndAcceptClient(browser, ownerPage, "vac-scope-client");

    const clients = await (await ownerPage.request.get(`${API_URL}/api/clients?limit=100`)).json();
    const clientRow = (clients.data ?? clients).find(
      (m: { user: { email: string } }) => m.user.email === clientEmail,
    );
    const clientUserId: string = clientRow.userId;
    const headers = { "x-csrf-token": await getCsrfTokenFromContext(ownerCtx) };

    const theirs = await (await ownerPage.request.post(`${API_URL}/api/projects`, {
      data: { name: "Scope E2E client project", clientUserIds: [clientUserId] },
      headers,
    })).json();
    const other = await (await ownerPage.request.post(`${API_URL}/api/projects`, {
      data: { name: "Scope E2E other project" },
      headers,
    })).json();

    const asClient = { "x-preview-as": clientUserId };
    const list = await (await ownerPage.request.get(`${API_URL}/api/projects/mine`, { headers: asClient })).json();
    const ids: string[] = list.data.map((p: { id: string }) => p.id);
    expect(ids).toContain(theirs.id);
    expect(ids).not.toContain(other.id);

    const otherRes = await ownerPage.request.get(`${API_URL}/api/projects/mine/${other.id}`, { headers: asClient });
    expect(otherRes.status()).toBe(404);

    // Previewing as themselves, the owner can still open a project with no client.
    const asSelf = await ownerPage.request.get(`${API_URL}/api/projects/mine/${other.id}`);
    expect(asSelf.ok()).toBe(true);

    await ownerCtx.close();
  });
  test("owner can preview portal as a client and mutations are blocked", async ({
    browser,
  }) => {
    const { context: ownerCtx, page: ownerPage } = await createOwner(browser);
    const { clientEmail, clientName } = await inviteAndAcceptClient(
      browser,
      ownerPage,
      "vac-client",
    );

    await openClientContact(ownerPage, clientEmail);
    const contactUrl: string = ownerPage.url();

    const viewButton = ownerPage.getByTestId("portal-access").getByRole("button", { name: "View as client" });
    await expect(viewButton).toBeVisible({ timeout: 10000 });

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
      .waitForURL(contactUrl, { timeout: 5000 })
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

    await openClientContact(ownerPage, clientEmail);
    const viewButton = ownerPage.getByTestId("portal-access").getByRole("button", { name: "View as client" });
    await expect(viewButton).toBeVisible({ timeout: 10000 });
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
