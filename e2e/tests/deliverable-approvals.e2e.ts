import { test, expect } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { createOwner, inviteAndAcceptClient } from "./helpers";

const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

async function csrf(ctx: BrowserContext): Promise<string> {
  return (await ctx.cookies()).find((c) => c.name === "csrf-token")?.value ?? "";
}

async function loginClient(browser: Browser, email: string, password: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: undefined });
  const page = await ctx.newPage();
  await page.goto(`${WEB_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/portal/, { timeout: 15000 });
  return { ctx, page };
}

test.describe("Deliverable approvals", () => {
  test.setTimeout(180000);

  test("request changes, upload v2, approve", async ({ browser }) => {
    const { context: ownerCtx, page: owner } = await createOwner(browser, "deliv-owner");
    const { clientEmail, password } = await inviteAndAcceptClient(browser, owner, "deliv-client");

    // Find the client's user id and create a project they're assigned to.
    const clientsRes = await owner.request.get(`${API_URL}/api/clients?limit=100`);
    const clients = await clientsRes.json();
    const clientRow = (clients.data ?? clients).find((m: { user: { email: string } }) => m.user.email === clientEmail);
    const projectRes = await owner.request.post(`${API_URL}/api/projects`, {
      data: { name: "Deliverables E2E", clientUserIds: [clientRow.userId] },
      headers: { "x-csrf-token": await csrf(ownerCtx) },
    });
    const project = await projectRes.json();

    // 1. Agency sends an image for approval through the UI.
    await owner.goto(`${WEB_URL}/dashboard/projects/${project.id}?tab=files`);
    await owner.getByRole("button", { name: /add/i }).first().click();
    await owner.getByText("Request approval").click();
    await owner.locator('input[type="file"]').last().setInputFiles({ name: "homepage.png", mimeType: "image/png", buffer: PNG });
    await owner.getByLabel(/note to client/i).fill("First pass at the homepage");
    await owner.getByRole("button", { name: /send for approval/i }).click();
    await expect(owner.getByText("Awaiting review").first()).toBeVisible();

    // The dashboard lists the pending approval (so its later absence is meaningful).
    await owner.goto(`${WEB_URL}/dashboard`);
    await expect(owner.getByTestId("pending-approvals-card")).toBeVisible();

    // 2. Client sees the banner, opens the review, can't send changes without a note.
    const { ctx: clientCtx, page: client } = await loginClient(browser, clientEmail, password);
    await client.goto(`${WEB_URL}/portal/projects/${project.id}`);
    await expect(client.getByText("1 item to review")).toBeVisible();
    await client.getByText("1 item to review").click();
    await client.getByRole("button", { name: /^review$/i }).first().click();
    await expect(client.getByTestId("deliverable-review").getByText("First pass at the homepage")).toBeVisible();
    await client.getByTestId("deliverable-review").getByRole("button", { name: /request changes/i }).click();
    await expect(client.getByRole("button", { name: /^send$/i })).toBeDisabled();
    await client.getByPlaceholder(/what should change/i).fill("Make the logo bigger");
    await client.getByRole("button", { name: /^send$/i }).click();
    // The review closes after a decision; reopen it to read the recorded decision.
    await expect(client.getByTestId("deliverable-review")).toHaveCount(0);
    await client.getByRole("button", { name: /^review$/i }).first().click();
    await expect(client.getByText(/changes requested by/i)).toBeVisible();
    await client.keyboard.press("Escape");

    // 3. Agency sees the note, uploads v2.
    await owner.goto(`${WEB_URL}/dashboard/projects/${project.id}?tab=files`);
    await expect(owner.getByText("Changes requested").first()).toBeVisible();
    await expect(owner.getByText(/Make the logo bigger/)).toBeVisible();
    await owner.getByText("homepage").first().click(); // expand the row
    await owner.getByTitle("Upload new version").click();
    await owner.locator('input[type="file"]').last().setInputFiles({ name: "homepage-v2.png", mimeType: "image/png", buffer: PNG });
    await owner.getByRole("button", { name: /send v2|upload v2/i }).click();
    await expect(owner.getByText("Awaiting review").first()).toBeVisible();
    const row = owner.getByRole("button").filter({ has: owner.getByText("homepage", { exact: true }) });
    await expect(row.getByText("v2", { exact: true })).toBeVisible();

    // 4. Client approves v2 through the deep link.
    const docs = await (await client.request.get(`${API_URL}/api/documents/mine/${project.id}`)).json();
    const docId: string = docs.data[0].id;
    await client.goto(`${WEB_URL}/portal/projects/${project.id}?tab=files&doc=${docId}`);
    await client.getByRole("button", { name: /^approve$/i }).click();
    await client.getByRole("button", { name: /^confirm$/i }).click();
    await expect(client.getByTestId("deliverable-review")).toHaveCount(0);
    await client.goto(`${WEB_URL}/portal/projects/${project.id}?tab=files&doc=${docId}`);
    await expect(client.getByText(/approved by/i)).toBeVisible();

    // Agency: approved, and the dashboard card is gone.
    await owner.goto(`${WEB_URL}/dashboard/projects/${project.id}?tab=files`);
    await expect(
      owner.getByRole("button").filter({ has: owner.getByText("homepage", { exact: true }) }).getByText("Approved", { exact: true }),
    ).toBeVisible();
    const pendingLoaded = owner.waitForResponse((r) => r.url().includes("/api/documents/approvals/pending") && r.ok());
    await owner.goto(`${WEB_URL}/dashboard`);
    await pendingLoaded;
    await expect(owner.getByTestId("pending-approvals-card")).toHaveCount(0);

    // 5. A stale decision on v1 is refused.
    const stale = await client.request.post(`${API_URL}/api/documents/${docId}/respond`, {
      data: { action: "declined", reason: "late", version: 1 },
      headers: { "x-csrf-token": await csrf(clientCtx) },
    });
    expect(stale.status()).toBe(409);

    await clientCtx.close();
    await ownerCtx.close();
  });

  test("link deliverable: client opens the link and approves; URL edit is refused", async ({ browser }) => {
    const { context: ownerCtx, page: owner } = await createOwner(browser, "deliv-link-owner");
    const { clientEmail, password } = await inviteAndAcceptClient(browser, owner, "deliv-link-client");
    const clients = await (await owner.request.get(`${API_URL}/api/clients?limit=100`)).json();
    const clientRow = (clients.data ?? clients).find((m: { user: { email: string } }) => m.user.email === clientEmail);
    const project = await (await owner.request.post(`${API_URL}/api/projects`, {
      data: { name: "Link Deliverable E2E", clientUserIds: [clientRow.userId] },
      headers: { "x-csrf-token": await csrf(ownerCtx) },
    })).json();

    const created = await (await owner.request.post(`${API_URL}/api/documents/link`, {
      data: { projectId: project.id, title: "Staging site", url: "https://example.com/staging", sendNow: true },
      headers: { "x-csrf-token": await csrf(ownerCtx) },
    })).json();
    expect(created.status).toBe("pending");

    const edit = await owner.request.patch(`${API_URL}/api/files/${created.fileId}`, {
      data: { url: "https://example.com/other" },
      headers: { "x-csrf-token": await csrf(ownerCtx) },
    });
    expect(edit.status()).toBe(400);

    const { ctx: clientCtx, page: client } = await loginClient(browser, clientEmail, password);
    await client.goto(`${WEB_URL}/portal/projects/${project.id}?tab=files&doc=${created.id}`);
    await expect(client.getByRole("link", { name: /open link/i })).toHaveAttribute("href", "https://example.com/staging");
    await client.getByRole("button", { name: /^approve$/i }).click();
    await client.getByRole("button", { name: /^confirm$/i }).click();
    await expect(client.getByTestId("deliverable-review")).toHaveCount(0);
    await client.goto(`${WEB_URL}/portal/projects/${project.id}?tab=files&doc=${created.id}`);
    await expect(client.getByText(/approved by/i)).toBeVisible();

    await clientCtx.close();
    await ownerCtx.close();
  });

  test("portal projects list shows a to-review chip", async ({ browser }) => {
    const { context: ownerCtx, page: owner } = await createOwner(browser, "deliv-chip-owner");
    const { clientEmail, password } = await inviteAndAcceptClient(browser, owner, "deliv-chip-client");
    const clients = await (await owner.request.get(`${API_URL}/api/clients?limit=100`)).json();
    const clientRow = (clients.data ?? clients).find((m: { user: { email: string } }) => m.user.email === clientEmail);
    const project = await (await owner.request.post(`${API_URL}/api/projects`, {
      data: { name: "Chip E2E", clientUserIds: [clientRow.userId] },
      headers: { "x-csrf-token": await csrf(ownerCtx) },
    })).json();
    await owner.request.post(`${API_URL}/api/documents/link`, {
      data: { projectId: project.id, title: "Mockups", url: "https://example.com/m", sendNow: true },
      headers: { "x-csrf-token": await csrf(ownerCtx) },
    });

    const { ctx: clientCtx, page: client } = await loginClient(browser, clientEmail, password);
    await client.goto(`${WEB_URL}/portal/projects`);
    await expect(client.getByTestId("to-review-chip")).toHaveText("1 to review");

    await clientCtx.close();
    await ownerCtx.close();
  });
});
