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
    await expect(owner.getByText("Send a design, draft or link for sign-off")).toBeVisible();
    await owner.getByText("Request approval", { exact: true }).click();
    // The approval checkbox is pre-checked by the menu item.
    await expect(owner.getByLabel("Ask client to approve")).toBeChecked();
    // Contract-only controls are hidden in approval mode.
    await expect(owner.getByText("Advanced options")).toHaveCount(0);
    await expect(owner.getByRole("button", { name: /save draft/i })).toHaveCount(0);
    await owner.locator('input[type="file"]').last().setInputFiles({ name: "homepage.png", mimeType: "image/png", buffer: PNG });
    await owner.getByLabel(/note to client/i).fill("First pass at the homepage");
    await owner.getByRole("button", { name: /send for approval/i }).click();
    await expect(owner.getByText("Awaiting review").first()).toBeVisible();

    // The dashboard lists the pending approval (so its later absence is meaningful).
    await owner.goto(`${WEB_URL}/dashboard`);
    await expect(owner.getByTestId("pending-approval")).toBeVisible();

    // 2. Client sees the banner, opens the review, can't send changes without a note.
    const { ctx: clientCtx, page: client } = await loginClient(browser, clientEmail, password);
    await client.goto(`${WEB_URL}/portal/projects/${project.id}`);
    // A single pending deliverable is highlighted on its own, with no extra summary banner.
    await expect(client.getByText("Needs your review")).toBeVisible();
    await expect(client.getByText("1 item to review")).toHaveCount(0);
    await client.getByRole("button", { name: /^review$/i }).first().click();
    await expect(client.getByTestId("deliverable-review").getByText("First pass at the homepage")).toBeVisible();
    await client.getByTestId("deliverable-review").getByRole("button", { name: /request changes/i }).click();
    const review = client.getByTestId("deliverable-review");
    await expect(review.getByRole("button", { name: /^send$/i })).toBeDisabled();
    await client.getByPlaceholder(/what should change/i).fill("Make the logo bigger");
    await review.getByRole("button", { name: /^send$/i }).click();
    // The review closes after a decision, and the overview stops highlighting it
    // (it's now waiting on the agency). Reopen it from the Files tab to read the decision.
    await expect(client.getByTestId("deliverable-review")).toHaveCount(0);
    await expect(client.getByText("Needs your review")).toHaveCount(0);
    await client.goto(`${WEB_URL}/portal/projects/${project.id}?tab=files`);
    await client.getByRole("button", { name: /^review$/i }).first().click();
    await expect(client.getByText(/changes requested by/i)).toBeVisible();
    await client.keyboard.press("Escape");

    // 3. Agency sees the note, uploads v2.
    await owner.goto(`${WEB_URL}/dashboard/projects/${project.id}?tab=files`);
    await expect(owner.getByText("Changes requested").first()).toBeVisible();
    await expect(owner.getByText(/Make the logo bigger/)).toBeVisible();
    // The collapsed row offers the next step directly; clicking it must not expand the row.
    await owner.getByRole("button", { name: "Send v2", exact: true }).click();
    await expect(owner.getByTitle("Upload new version")).toHaveCount(0);
    await owner.locator('input[type="file"]').last().setInputFiles({ name: "homepage-v2.png", mimeType: "image/png", buffer: PNG });
    await owner.locator("button").filter({ hasText: /^Send v2$/ }).click();
    await expect(owner.getByText("Awaiting review").first()).toBeVisible();
    const row = owner.getByRole("button").filter({ has: owner.getByText("homepage", { exact: true }) });
    await expect(row.getByText("v2", { exact: true })).toBeVisible();

    // The deliverable's files are not repeated as plain files, for agency and client.
    await owner.reload();
    await expect(owner.getByText(/homepage(-v2)?\.png/)).toHaveCount(1);
    await client.goto(`${WEB_URL}/portal/projects/${project.id}?tab=files`);
    await expect(client.getByText("Awaiting review").first()).toBeVisible();
    // Portal document rows show the title, so a plain file row would be the only place a filename appears.
    // The title shows twice: in the "Needs your review" card and in the Files list.
    await expect(client.getByTestId("review-highlight").getByText("homepage", { exact: true })).toHaveCount(1);
    await expect(client.getByText("homepage", { exact: true })).toHaveCount(2);
    await expect(client.getByText(/homepage(-v2)?\.png/)).toHaveCount(0);
    const clientProject = await (await client.request.get(`${API_URL}/api/projects/mine/${project.id}`)).json();
    expect(clientProject.files).toEqual([]);

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
    await expect(owner.getByTestId("pending-approval")).toHaveCount(0);

    // 5. A stale decision on v1 is refused.
    const stale = await client.request.post(`${API_URL}/api/documents/${docId}/respond`, {
      data: { action: "declined", reason: "late", version: 1 },
      headers: { "x-csrf-token": await csrf(clientCtx) },
    });
    expect(stale.status()).toBe(409);

    await clientCtx.close();
    await ownerCtx.close();
  });

  test("the banner counts only what the highlighted deliverable card doesn't cover", async ({ browser }) => {
    const { context: ownerCtx, page: owner } = await createOwner(browser, "deliv-banner-owner");
    const { clientEmail, password } = await inviteAndAcceptClient(browser, owner, "deliv-banner-client");
    const clients = await (await owner.request.get(`${API_URL}/api/clients?limit=100`)).json();
    const clientRow = (clients.data ?? clients).find((m: { user: { email: string } }) => m.user.email === clientEmail);
    const headers = { "x-csrf-token": await csrf(ownerCtx) };
    const project = await (await owner.request.post(`${API_URL}/api/projects`, {
      data: { name: "Banner Count E2E", clientUserIds: [clientRow.userId] },
      headers,
    })).json();
    const deliverable = await owner.request.post(`${API_URL}/api/documents/link`, {
      data: { projectId: project.id, title: "Homepage mockup", url: "https://example.com/mockup", sendNow: true },
      headers,
    });
    expect(deliverable.ok()).toBe(true);
    const decision = await owner.request.post(`${API_URL}/api/tasks?projectId=${project.id}`, {
      data: { title: "Pick a font", type: "decision", question: "Which font?", options: [{ label: "Serif" }, { label: "Sans" }] },
      headers,
    });
    expect(decision.ok()).toBe(true);

    const { ctx: clientCtx, page: client } = await loginClient(browser, clientEmail, password);
    await client.goto(`${WEB_URL}/portal/projects/${project.id}`);
    await expect(client.getByTestId("review-highlight").getByText("Homepage mockup", { exact: true })).toBeVisible();
    // Only the vote is left for the banner: the deliverable isn't counted twice.
    await expect(client.getByText("1 more item to review")).toBeVisible();
    await expect(client.getByText("1 vote", { exact: true })).toBeVisible();
    await expect(client.getByText(/to approve/)).toHaveCount(0);

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

  test("approval can be requested from Upload file and the two modals switch", async ({ browser }) => {
    const { context: ownerCtx, page: owner } = await createOwner(browser, "deliv-switch-owner");
    const project = await (await owner.request.post(`${API_URL}/api/projects`, {
      data: { name: "Approval Switch E2E" },
      headers: { "x-csrf-token": await csrf(ownerCtx) },
    })).json();

    await owner.goto(`${WEB_URL}/dashboard/projects/${project.id}?tab=files`);
    // Empty state links into the same flow.
    await owner.getByRole("button", { name: "request approval" }).click();
    await expect(owner.getByLabel("Ask client to approve")).toBeChecked();
    await owner.getByRole("button", { name: "Use a link instead" }).click();
    await expect(owner.getByRole("heading", { name: "Add Link" })).toBeVisible();
    await expect(owner.getByLabel("Ask client to approve")).toBeChecked();
    await owner.getByRole("button", { name: "Upload a file instead" }).click();
    await expect(owner.getByRole("heading", { name: "Upload File" })).toBeVisible();
    await owner.getByRole("button", { name: "Cancel", exact: true }).click();

    // Plain Upload file: checkbox unchecked, neutral defaults.
    await owner.getByRole("button", { name: /add/i }).first().click();
    await owner.getByText("Share a file with the client").click();
    await expect(owner.getByLabel("Ask client to approve")).not.toBeChecked();
    await expect(owner.getByPlaceholder("e.g., Homepage concept")).toBeVisible();
    await expect(owner.locator("select").first()).toHaveValue("other");
    await owner.getByLabel("Ask client to approve").check();
    await expect(owner.getByRole("button", { name: /send for approval/i })).toBeVisible();

    await ownerCtx.close();
  });

  test("Add link with 'Ask client to approve' sends a link deliverable", async ({ browser }) => {
    const { context: ownerCtx, page: owner } = await createOwner(browser, "deliv-uilink-owner");
    const project = await (await owner.request.post(`${API_URL}/api/projects`, {
      data: { name: "UI Link Deliverable E2E" },
      headers: { "x-csrf-token": await csrf(ownerCtx) },
    })).json();

    await owner.goto(`${WEB_URL}/dashboard/projects/${project.id}?tab=files`);
    await owner.getByRole("button", { name: /add/i }).first().click();
    await owner.getByText("Add link", { exact: true }).click();
    await owner.getByPlaceholder("https://...").fill("https://example.com/figma");
    await owner.getByPlaceholder(/design mockup/i).fill("Figma board");
    await owner.getByLabel("Ask client to approve").check();
    await owner.getByLabel(/note to client/i).fill("Please review");
    await owner.getByRole("button", { name: "Send for approval" }).click();
    await expect(owner.getByText("Awaiting review").first()).toBeVisible();
    // Only the type-less status pill is shown for deliverables.
    await expect(owner.getByText("For approval", { exact: true })).toHaveCount(0);

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

  test("two clients: latest deliverable decision wins, contracts still need every client", async ({ browser }) => {
    const { context: ownerCtx, page: owner } = await createOwner(browser, "deliv-two-owner");
    const a = await inviteAndAcceptClient(browser, owner, "deliv-two-a");
    const b = await inviteAndAcceptClient(browser, owner, "deliv-two-b");
    const clients = await (await owner.request.get(`${API_URL}/api/clients?limit=100`)).json();
    const rows: { userId: string; user: { email: string } }[] = clients.data ?? clients;
    const rowA = rows.find((m) => m.user.email === a.clientEmail)!;
    const rowB = rows.find((m) => m.user.email === b.clientEmail)!;
    const ownerCsrf: string = await csrf(ownerCtx);
    const project = await (await owner.request.post(`${API_URL}/api/projects`, {
      data: { name: "Two Clients E2E", clientUserIds: [rowA.userId, rowB.userId] },
      headers: { "x-csrf-token": ownerCsrf },
    })).json();

    const deliverable = await (await owner.request.post(`${API_URL}/api/documents/link`, {
      data: { projectId: project.id, title: "Brand board", url: "https://example.com/brand", sendNow: true },
      headers: { "x-csrf-token": ownerCsrf },
    })).json();
    const contractRes = await owner.request.post(`${API_URL}/api/documents`, {
      multipart: {
        projectId: project.id,
        type: "contract",
        title: "Service agreement",
        requiresApproval: "true",
        sendNow: "true",
        file: { name: "agreement.png", mimeType: "image/png", buffer: PNG },
      },
      headers: { "x-csrf-token": ownerCsrf },
    });
    expect(contractRes.ok()).toBeTruthy();
    const contract = await contractRes.json();
    expect(contract.status).toBe("pending");

    const { ctx: ctxA, page: clientA } = await loginClient(browser, a.clientEmail, a.password);
    const { ctx: ctxB, page: clientB } = await loginClient(browser, b.clientEmail, b.password);

    // Client A approves the deliverable.
    await clientA.goto(`${WEB_URL}/portal/projects/${project.id}?tab=files&doc=${deliverable.id}`);
    await clientA.getByRole("button", { name: /^approve$/i }).click();
    await clientA.getByRole("button", { name: /^confirm$/i }).click();
    await expect(clientA.getByTestId("deliverable-review")).toHaveCount(0);

    // Client B changes the decision to "request changes".
    await clientB.goto(`${WEB_URL}/portal/projects/${project.id}?tab=files&doc=${deliverable.id}`);
    await expect(clientB.getByText(/approved by/i)).toBeVisible();
    await clientB.getByRole("button", { name: /change decision/i }).click();
    await clientB.getByTestId("deliverable-review").getByRole("button", { name: /request changes/i }).click();
    await clientB.getByPlaceholder(/what should change/i).fill("Try a darker palette");
    await clientB.getByRole("button", { name: /^send$/i }).click();
    await expect(clientB.getByTestId("deliverable-review")).toHaveCount(0);

    // The status follows the latest decision.
    await owner.goto(`${WEB_URL}/dashboard/projects/${project.id}?tab=files`);
    await expect(owner.getByText("Changes requested").first()).toBeVisible();
    await expect(owner.getByText(/Try a darker palette/)).toBeVisible();

    // A contract still needs every client: one acceptance leaves it pending.
    const acceptRes = await clientA.request.post(`${API_URL}/api/documents/${contract.id}/respond`, {
      data: { action: "accepted" },
      headers: { "x-csrf-token": await csrf(ctxA) },
    });
    expect(acceptRes.ok()).toBeTruthy();
    const afterOne = await (await owner.request.get(`${API_URL}/api/documents/${contract.id}`)).json();
    expect(afterOne.status).toBe("pending");

    const acceptB = await clientB.request.post(`${API_URL}/api/documents/${contract.id}/respond`, {
      data: { action: "accepted" },
      headers: { "x-csrf-token": await csrf(ctxB) },
    });
    expect(acceptB.ok()).toBeTruthy();
    const afterAll = await (await owner.request.get(`${API_URL}/api/documents/${contract.id}`)).json();
    expect(afterAll.status).toBe("accepted");

    await ctxA.close();
    await ctxB.close();
    await ownerCtx.close();
  });

  test("portal banner counts an open vote that sits beyond the first page of tasks", async ({ browser }) => {
    const { context: ownerCtx, page: owner } = await createOwner(browser, "vote-page-owner");
    const { clientEmail, password } = await inviteAndAcceptClient(browser, owner, "vote-page-client");
    const clients = await (await owner.request.get(`${API_URL}/api/clients?limit=100`)).json();
    const clientRow = (clients.data ?? clients).find((m: { user: { email: string } }) => m.user.email === clientEmail);
    const token: string = await csrf(ownerCtx);
    const project = await (await owner.request.post(`${API_URL}/api/projects`, {
      data: { name: "Paged votes E2E", clientUserIds: [clientRow.userId] },
      headers: { "x-csrf-token": token },
    })).json();

    // 21 ordinary tasks fill page 1 (20 per page); the decision lands on page 2.
    for (let i = 1; i <= 21; i++) {
      const res = await owner.request.post(`${API_URL}/api/tasks?projectId=${project.id}`, {
        data: { title: `Task ${i}` },
        headers: { "x-csrf-token": token },
      });
      expect(res.ok()).toBe(true);
    }
    const decision = await owner.request.post(`${API_URL}/api/tasks?projectId=${project.id}`, {
      data: { title: "Pick a palette", type: "decision", question: "Which palette?", options: [{ label: "Warm" }, { label: "Cool" }] },
      headers: { "x-csrf-token": token },
    });
    expect(decision.ok()).toBe(true);

    const { ctx: clientCtx, page: client } = await loginClient(browser, clientEmail, password);
    await client.goto(`${WEB_URL}/portal/projects/${project.id}`);
    await expect(client.getByText("1 item to review")).toBeVisible();
    await expect(client.getByText("1 vote")).toBeVisible();

    await clientCtx.close();
    await ownerCtx.close();
  });
});
