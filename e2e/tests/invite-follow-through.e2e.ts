import { test, expect } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { openClientContact } from "./helpers";

const API = "http://localhost:3001/api";
const WEB = "http://localhost:3000";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
}

/** A fresh workspace, so invites never collide with the shared test account's plan limits. */
async function createOwner(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context: BrowserContext = await browser.newContext({ storageState: undefined });
  const page: Page = await context.newPage();
  const res = await page.request.post(`${API}/onboarding/signup`, {
    data: {
      name: "Follow Owner",
      email: uniqueEmail("follow-owner"),
      password: "FollowOwner123!",
      orgName: `Follow Org ${Date.now().toString(36)}`,
    },
  });
  if (!res.ok()) throw new Error(`Owner signup failed (${res.status()}): ${await res.text()}`);
  await page.request.get(`${API}/setup/status`);
  const csrf: string = (await context.cookies()).find((c) => c.name === "csrf-token")?.value ?? "";
  await page.request.post(`${API}/setup/complete`, { headers: { "x-csrf-token": csrf } });
  return { context, page };
}

async function invite(page: Page, email: string): Promise<string> {
  const res = await page.request.post(`${API}/auth/organization/invite-member`, {
    data: { email, role: "member" },
    headers: { Origin: WEB },
  });
  if (!res.ok()) throw new Error(`Invite failed (${res.status()}): ${await res.text()}`);
  const body = await res.json();
  return body.id ?? body.invitation?.id;
}

test.describe("Client invite follow-through", () => {
  test("invites last two weeks, not Better Auth's default 48 hours", async ({ browser }) => {
    const { context, page } = await createOwner(browser);
    await invite(page, uniqueEmail("follow-expiry"));

    const res = await page.request.get(`${API}/clients/invitations`);
    expect(res.ok()).toBeTruthy();
    const [inv] = (await res.json()) as { expiresAt: string; expired: boolean }[];
    const days: number = (new Date(inv.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(13);
    expect(inv.expired).toBe(false);
    await context.close();
  });

  test("an invitation gives the invitee a contact, listed as Invite pending", async ({ browser }) => {
    const { context, page } = await createOwner(browser);
    const email: string = uniqueEmail("follow-contact");
    await invite(page, email);

    await page.goto(`${WEB}/dashboard/contacts?access=pending`);
    await expect(page.getByLabel("Filter by portal access")).toHaveValue("pending");
    const row = page.getByTestId("contact-row").filter({ hasText: email });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("portal-badge")).toHaveText("Invite pending");
    await context.close();
  });

  test("owner can resend a pending client invitation from the contact page", async ({ browser }) => {
    const { context, page } = await createOwner(browser);
    const email: string = uniqueEmail("follow-resend");
    await invite(page, email);

    await openClientContact(page, email);
    const bar = page.getByTestId("pending-invite");
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button", { name: "Copy invite link" })).toBeVisible();

    await page.getByRole("button", { name: "Resend invite" }).click();
    await expect(page.getByText("Invitation renewed")).toBeVisible();
    // Resending a live invite extends it rather than adding a second one.
    const invitations = (await (await page.request.get(`${API}/clients/invitations`)).json()) as { email: string }[];
    expect(invitations.filter((i) => i.email === email)).toHaveLength(1);
    await context.close();
  });

  test("the contact page shows whether a client has visited the portal", async ({ browser }) => {
    const { context: ownerCtx, page: ownerPage } = await createOwner(browser);
    const clientEmail: string = uniqueEmail("follow-client");
    const invitationId: string = await invite(ownerPage, clientEmail);

    const clientCtx: BrowserContext = await browser.newContext({ storageState: undefined });
    const clientPage: Page = await clientCtx.newPage();
    await clientPage.goto(`${WEB}/accept-invite?id=${invitationId}`);
    await clientPage.getByLabel(/your name/i).fill("Follow Client");
    await clientPage.getByLabel(/email/i).fill(clientEmail);
    await clientPage.getByLabel(/password/i).fill("FollowClient123!");
    await clientPage.getByRole("button", { name: /create account & join/i }).click();
    await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });
    // Loading the portal makes authenticated API calls, which record the visit.
    await clientPage.waitForLoadState("networkidle");
    await clientCtx.close();

    await openClientContact(ownerPage, clientEmail);
    await expect(ownerPage.getByTestId("portal-access").getByTestId("client-last-seen")).toHaveText("Active today");
    await ownerCtx.close();
  });
});
