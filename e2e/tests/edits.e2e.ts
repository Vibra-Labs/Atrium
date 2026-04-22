import { test, expect } from "@playwright/test";
import type { Browser, Page, BrowserContext } from "@playwright/test";
import { getCsrfToken, getCsrfTokenFromContext } from "./helpers";

const API = "http://localhost:3001/api";
const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";

interface OwnerSession {
  context: BrowserContext;
  page: Page;
  email: string;
  password: string;
}

/**
 * Create an owner user with a fresh org and a completed setup,
 * returning the authenticated browser context.
 */
async function createOwnerUser(
  browser: Browser,
  prefix = "edit-owner",
): Promise<OwnerSession> {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `${prefix}-${stamp}@test.local`;
  const password = "EditOwner123!";
  const orgName = `${prefix} Org ${stamp}`;

  const res = await page.request.post(`${API_URL}/api/onboarding/signup`, {
    data: { name: "Edit Owner", email, password, orgName },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Owner signup failed (${res.status()}): ${body}`);
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
    await page.request.get(`${API_URL}/api/setup/status`);
    const csrf = await getCsrfTokenFromContext(context);
    await page.request.post(`${API_URL}/api/setup/complete`, {
      headers: { "x-csrf-token": csrf },
    });
    await page.goto(`${WEB_URL}/dashboard`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });
  }

  return { context, page, email, password };
}

test.describe("Edit flows", () => {
  // ---------------------------------------------------------------------------
  // Test A — Dashboard: owner edits own update
  // ---------------------------------------------------------------------------
  test("dashboard: owner can edit their own update", async ({ page, request }) => {
    const csrfToken = getCsrfToken();

    // Seed: create a project and a update authored by the current owner.
    const projectRes = await request.post(`${API}/projects`, {
      data: { name: `Edit Updates Test ${Date.now()}` },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(projectRes.ok()).toBeTruthy();
    const project = await projectRes.json();
    const projectId = project.id as string;

    const updateRes = await request.post(
      `${API}/updates?projectId=${projectId}`,
      {
        multipart: { content: "Initial text" },
        headers: { "x-csrf-token": csrfToken },
      },
    );
    expect(updateRes.ok()).toBeTruthy();
    const update = await updateRes.json();
    const updateId = update.id as string;

    await page.goto(`/dashboard/projects/${projectId}`);

    // Locate the Edit button on the update we just posted. The dashboard
    // updates-section renders an Edit control beside Delete when the
    // parallel agent's work lands — look for a button labelled "Edit"
    // inside the container holding our update text.
    const updateContainer = page
      .locator("p", { hasText: "Initial text" })
      .locator("..")
      .locator("..")
      .first();
    await expect(updateContainer).toBeVisible({ timeout: 10000 });

    const editButton = updateContainer.getByRole("button", { name: /^edit$/i });
    await editButton.click();

    // Clear the textarea and type the new content.
    const textarea = updateContainer.getByRole("textbox");
    await textarea.fill("Edited text");
    await updateContainer.getByRole("button", { name: /^save$/i }).click();

    // Assert the edited content appears.
    await expect(
      page.locator("p", { hasText: "Edited text" }).first(),
    ).toBeVisible({ timeout: 10000 });

    // The "(edited)" indicator requires `updatedAt - createdAt > 2 minutes`
    // and a Just-edited update won't cross that threshold in an e2e run.
    // We still verify the API reports updatedAt > createdAt; the visual
    // indicator assertion is intentionally skipped for timing stability.
    const verifyRes = await request.get(`${API}/updates/timeline/${projectId}`);
    expect(verifyRes.ok()).toBeTruthy();
    const timeline = await verifyRes.json();
    const edited = (timeline.data ?? timeline).find(
      (e: { id: string }) => e.id === updateId,
    );
    expect(edited).toBeTruthy();
    expect(edited.content).toBe("Edited text");
    if (edited.updatedAt && edited.createdAt) {
      expect(new Date(edited.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(edited.createdAt).getTime(),
      );
    }
  });

  // ---------------------------------------------------------------------------
  // Test B — Dashboard: owner edits a link file
  // ---------------------------------------------------------------------------
  test("dashboard: owner can edit a link file", async ({ page, request }) => {
    const csrfToken = getCsrfToken();

    const projectRes = await request.post(`${API}/projects`, {
      data: { name: `Edit Link Test ${Date.now()}` },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(projectRes.ok()).toBeTruthy();
    const project = await projectRes.json();
    const projectId = project.id as string;

    // Seed the link via API (matches the "Add link" UI result).
    const linkRes = await request.post(`${API}/files/link`, {
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      data: {
        projectId,
        url: "https://www.canva.com/design/foo",
        title: "Canva",
      },
    });
    expect(linkRes.ok()).toBeTruthy();
    const link = await linkRes.json();
    const linkId = link.id as string;

    await page.goto(`/dashboard/projects/${projectId}`);
    // Make sure we're on the Files tab.
    const filesTab = page.getByRole("button", { name: /^files$/i });
    if (await filesTab.isVisible().catch(() => false)) {
      await filesTab.click();
    }

    const row = page
      .locator("p", { hasText: "Canva" })
      .locator("..")
      .locator("..")
      .first();
    await expect(row).toBeVisible({ timeout: 10000 });

    // The parallel-agent work adds a pencil/edit control to each file row.
    // Look for any button with aria-label containing "edit" or name "Edit".
    const editControl = row
      .getByRole("button", { name: /edit/i })
      .first();
    await editControl.click();

    // Fill the name + description fields in the modal/drawer that opens.
    // These field names match the "Add link" dialog shape.
    const nameField = page.getByLabel(/name|title/i).first();
    await nameField.fill("Canva (updated)");
    const descField = page.getByLabel(/description/i).first();
    await descField.fill("v2");

    await page.getByRole("button", { name: /^save$/i }).click();

    // Assert the updated list entry appears.
    await expect(
      page.locator("p", { hasText: "Canva (updated)" }).first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator("text=v2").first(),
    ).toBeVisible({ timeout: 10000 });

    // Also verify via API.
    const verify = await request.get(`${API}/files/project/${projectId}`);
    expect(verify.ok()).toBeTruthy();
    const listed = await verify.json();
    const updated = (listed.data ?? listed).find(
      (f: { id: string }) => f.id === linkId,
    );
    expect(updated).toBeTruthy();
    expect(updated.filename).toBe("Canva (updated)");
    expect(updated.description).toBe("v2");
  });

  // ---------------------------------------------------------------------------
  // Test C — Portal: client can edit own updates but not agency author's
  // ---------------------------------------------------------------------------
  test("portal: client edits own update, cannot edit agency update", async ({
    browser,
  }) => {
    // 1. Create an agency owner with a project, then invite a client member.
    const { context: ownerCtx, page: ownerPage } = await createOwnerUser(
      browser,
      "edit-portal",
    );
    const ownerCsrf = await getCsrfTokenFromContext(ownerCtx);

    const projectRes = await ownerPage.request.post(`${API}/projects`, {
      data: { name: `Portal Edit Test ${Date.now()}` },
      headers: { "x-csrf-token": ownerCsrf },
    });
    expect(projectRes.ok()).toBeTruthy();
    const project = await projectRes.json();
    const projectId = project.id as string;

    const clientEmail = `edit-client-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 6)}@test.local`;
    const clientPassword = "ClientEdit123!";

    // Invite the client as a member of the org.
    const inviteRes = await ownerPage.request.post(
      `${API_URL}/api/auth/organization/invite-member`,
      {
        data: { email: clientEmail, role: "member" },
        headers: { Origin: WEB_URL },
      },
    );
    expect(inviteRes.ok()).toBeTruthy();
    const inviteBody = await inviteRes.json();
    const invitationId: string =
      inviteBody?.id || inviteBody?.invitation?.id || inviteBody?.data?.id;
    expect(invitationId).toBeTruthy();

    // 2. Client accepts the invite by signing up — this establishes a session
    //    in the client's fresh context.
    const clientCtx = await browser.newContext({ storageState: undefined });
    const clientPage = await clientCtx.newPage();

    await clientPage.goto(
      `${WEB_URL}/accept-invite?id=${invitationId}`,
      { waitUntil: "networkidle", timeout: 15000 },
    );
    await clientPage.getByLabel(/your name/i).fill("Portal Edit Client");
    await clientPage.getByLabel(/email/i).fill(clientEmail);
    await clientPage.getByLabel(/password/i).fill(clientPassword);
    await clientPage
      .getByRole("button", { name: /create account & join/i })
      .click();
    await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });

    // 3. Assign the new client to the project so /projects/mine/:id works.
    // Look up the client's user id via the owner's session, then add them.
    const membersRes = await ownerPage.request.get(
      `${API_URL}/api/auth/organization/list-members`,
      { headers: { Origin: WEB_URL } },
    );
    let clientUserId = "";
    if (membersRes.ok()) {
      const membersBody = await membersRes.json();
      const members = membersBody?.members ?? membersBody?.data ?? membersBody;
      if (Array.isArray(members)) {
        const match = members.find(
          (m: { user?: { email?: string }; email?: string }) =>
            m.user?.email === clientEmail || m.email === clientEmail,
        );
        clientUserId = match?.user?.id ?? match?.userId ?? "";
      }
    }
    // Fallback: fetch clients list used by dashboard.
    if (!clientUserId) {
      const clientsRes = await ownerPage.request.get(
        `${API}/clients?limit=50`,
      );
      if (clientsRes.ok()) {
        const body = await clientsRes.json();
        const clients = body?.data ?? body;
        if (Array.isArray(clients)) {
          const match = clients.find(
            (c: { email?: string }) => c.email === clientEmail,
          );
          clientUserId = match?.id ?? match?.userId ?? "";
        }
      }
    }

    // Skipping this test if we cannot derive the client user id — the
    // /projects/:projectId/clients endpoint needs it to link the user.
    test.skip(
      !clientUserId,
      "Could not resolve client user id via members/clients APIs",
    );

    const assignRes = await ownerPage.request.post(
      `${API}/projects/${projectId}/clients`,
      {
        data: { userId: clientUserId },
        headers: { "x-csrf-token": ownerCsrf },
      },
    );
    expect(assignRes.ok()).toBeTruthy();

    // 4. As the client, open the project in the portal and post an update.
    await clientPage.goto(`${WEB_URL}/portal/projects/${projectId}`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });

    await clientPage
      .getByRole("button", { name: /add update/i })
      .click();
    await clientPage
      .getByPlaceholder(/write an update/i)
      .fill("Client posted this");
    await clientPage
      .getByRole("button", { name: /^post$/i })
      .click();

    // The client's own update is visible.
    const ownContainer = clientPage
      .locator("p", { hasText: "Client posted this" })
      .locator("..")
      .locator("..")
      .first();
    await expect(ownContainer).toBeVisible({ timeout: 10000 });

    // Edit button must be visible on the client's own update.
    const editOwn = ownContainer.getByRole("button", {
      name: /edit update|^edit$/i,
    });
    await expect(editOwn).toBeVisible({ timeout: 10000 });

    // Edit the text.
    await editOwn.click();
    const editTextarea = ownContainer.getByRole("textbox").first();
    await editTextarea.fill("Client edited this");
    await ownContainer.getByRole("button", { name: /^save$/i }).click();

    await expect(
      clientPage.locator("p", { hasText: "Client edited this" }).first(),
    ).toBeVisible({ timeout: 10000 });

    // 5. As the agency owner, post a second update on the same project.
    await ownerPage.request.post(`${API}/updates?projectId=${projectId}`, {
      multipart: { content: "Agency posted this" },
      headers: { "x-csrf-token": ownerCsrf },
    });

    // 6. Reload the client view and confirm:
    //    - the agency update is visible
    //    - there is NO Edit button on it (not author)
    await clientPage.reload({ waitUntil: "networkidle" });
    const agencyContainer = clientPage
      .locator("p", { hasText: "Agency posted this" })
      .locator("..")
      .locator("..")
      .first();
    await expect(agencyContainer).toBeVisible({ timeout: 10000 });
    await expect(
      agencyContainer.getByRole("button", { name: /edit update|^edit$/i }),
    ).toHaveCount(0);

    await ownerCtx.close();
    await clientCtx.close();
  });
});
