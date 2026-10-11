import { test, expect } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const API = "http://localhost:3001/api";
const WEB = "http://localhost:3000";
const DAY_MS = 24 * 60 * 60 * 1000;

interface Owner {
  context: BrowserContext;
  page: Page;
  email: string;
  csrf: string;
}

/** Sign up a brand-new workspace so the test owns its trial from day one. */
async function signUpOwner(browser: Browser): Promise<Owner> {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  const email = `trial-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const res = await page.request.post(`${API}/onboarding/signup`, {
    data: { name: "Trial Owner", email, password: "TrialPass123!", orgName: `Trial Org ${Date.now()}` },
  });
  if (!res.ok()) throw new Error(`Signup failed (${res.status()}): ${await res.text()}`);

  await page.request.get(`${API}/setup/status`);
  const csrf: string = (await context.cookies()).find((c) => c.name === "csrf-token")?.value ?? "";
  await page.request.post(`${API}/setup/complete`, { headers: { "x-csrf-token": csrf } });
  return { context, page, email, csrf };
}

type Prisma = import("@prisma/client").PrismaClient;

/** Run a query against the local database, which owns trial state. */
async function withDb<T>(fn: (prisma: Prisma) => Promise<T>): Promise<T> {
  // Loaded lazily so runs with billing off (CI) never need a database client.
  // Resolved from the database package, which owns the generated Prisma client.
  const requireFromDb = createRequire(resolve(__dirname, "../../packages/database/package.json"));
  const { PrismaClient } = requireFromDb("@prisma/client") as typeof import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function ownerOrgId(prisma: Prisma, email: string): Promise<string> {
  const member = await prisma.member.findFirstOrThrow({ where: { user: { email }, role: "owner" } });
  return member.organizationId;
}

/** Move the workspace's trial end date into the past, as if 14 days had gone by. */
async function endTrial(email: string): Promise<void> {
  await withDb(async (prisma) => {
    await prisma.subscription.update({
      where: { organizationId: await ownerOrgId(prisma, email) },
      data: { currentPeriodEnd: new Date(Date.now() - 60_000) },
    });
  });
}

function signatureDocMultipart(projectId: string): { body: string; boundary: string } {
  const boundary = `----TrialBoundary${Date.now()}`;
  const field = (name: string, value: string): string[] => [
    `--${boundary}`,
    `Content-Disposition: form-data; name="${name}"`,
    "",
    value,
  ];
  const body = [
    ...field("projectId", projectId),
    ...field("type", "contract"),
    ...field("title", "Trial contract"),
    ...field("requiresSignature", "true"),
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="trial.pdf"',
    "Content-Type: application/pdf",
    "",
    "fake pdf content",
    `--${boundary}--`,
  ].join("\r\n");
  return { body, boundary };
}

test.describe.serial("Pro trial", () => {
  let owner: Owner;
  let documentId: string;
  const domain = `portal-${Date.now()}.trial-e2e.example.com`;

  test.beforeAll(async ({ browser, request }) => {
    const config = await (await request.get(`${API}/health/config`)).json();
    test.skip(!config.billingEnabled, "Trials only exist when billing is enabled");
    owner = await signUpOwner(browser);
  });

  test.afterAll(async () => {
    await owner?.context.close();
  });

  test("a new workspace starts on a 14-day Pro trial with every feature", async () => {
    const res = await owner.page.request.get(`${API}/billing/features`);
    const body: { features: Record<string, boolean>; trialEndsAt: string | null } = await res.json();
    expect(Object.values(body.features).every(Boolean)).toBe(true);
    expect(body.trialEndsAt).not.toBeNull();
    const daysLeft: number = (new Date(body.trialEndsAt as string).getTime() - Date.now()) / DAY_MS;
    expect(daysLeft).toBeGreaterThan(13.9);
    expect(daysLeft).toBeLessThanOrEqual(14);
  });

  test("the dashboard shows how long the trial has left", async () => {
    await owner.page.goto(`${WEB}/dashboard`);
    const banner = owner.page.getByTestId("trial-banner");
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText("14 days left");
    await expect(banner.getByRole("link", { name: /keep pro/i })).toHaveAttribute("href", "/dashboard/settings/billing");
  });

  test("Pro features are tagged during the trial so owners learn what they'd lose", async () => {
    // The payments section renders only after /payments/status answers, which is slow when
    // the whole suite is hammering the dev server; allow the full default wait.
    await owner.page.goto(`${WEB}/dashboard/settings/payments`);
    await expect(owner.page.getByTestId("trial-tag").first()).toBeVisible({ timeout: 30000 });
    await owner.page.goto(`${WEB}/dashboard/settings/workspace`);
    await expect(owner.page.getByTestId("trial-tag").first()).toBeVisible({ timeout: 30000 });
  });

  test("the billing page offers Pro during the trial", async () => {
    await owner.page.goto(`${WEB}/dashboard/settings/billing`);
    await expect(owner.page.getByTestId("trial-ends")).toBeVisible({ timeout: 15000 });
    await expect(owner.page.getByRole("button", { name: /upgrade to pro/i })).toBeVisible();
  });

  test("Pro features can be set up during the trial", async () => {
    const { request } = owner.page;
    const headers = { "x-csrf-token": owner.csrf };

    const domainRes = await request.put(`${API}/settings/custom-domain`, { data: { domain }, headers });
    expect(domainRes.status()).toBe(200);
    expect((await request.get(`${API}/branding/domain?host=${domain}`)).status()).toBe(200);
    expect((await request.get(`${API}/health/domain-check?domain=${domain}`)).status()).toBe(200);

    const project = await (await request.post(`${API}/projects`, { data: { name: "Trial project" }, headers })).json();
    const { body, boundary } = signatureDocMultipart(project.id);
    const docRes = await request.post(`${API}/documents`, {
      data: body,
      headers: { ...headers, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(docRes.status()).toBe(201);
    documentId = (await docRes.json()).id;

    const fieldsRes = await request.put(`${API}/documents/${documentId}/signature-fields`, {
      data: { fields: [{ pageNumber: 0, x: 0.1, y: 0.8, width: 0.3, height: 0.06, type: "signature" }] },
      headers,
    });
    expect(fieldsRes.ok()).toBe(true);
  });

  test("when the trial ends the workspace drops to Free and set-up features stop working", async () => {
    await endTrial(owner.email);
    const { request } = owner.page;

    const body: { features: Record<string, boolean>; trialEndsAt: string | null } =
      await (await request.get(`${API}/billing/features`)).json();
    expect(body.trialEndsAt).toBeNull();
    expect(Object.values(body.features).some(Boolean)).toBe(false);

    // The saved custom domain stops resolving, for the portal and for TLS issuance.
    expect((await request.get(`${API}/branding/domain?host=${domain}`)).status()).toBe(204);
    expect((await request.get(`${API}/health/domain-check?domain=${domain}`)).status()).toBe(404);

    // A signature document prepared during the trial can no longer be sent.
    const sendRes = await request.post(`${API}/documents/${documentId}/send`, {
      data: {},
      headers: { "x-csrf-token": owner.csrf },
    });
    expect(sendRes.status()).toBe(403);
    expect((await sendRes.json()).message).toMatch(/available on paid plans/i);

    const sub = await (await request.get(`${API}/billing/subscription`)).json();
    expect(sub.subscription.plan.slug).toBe("free");

    // The hourly trial-email job picks up subscriptions with trialEndedAt set and no email sent yet.
    const row = await withDb(async (prisma) =>
      prisma.subscription.findUniqueOrThrow({ where: { organizationId: await ownerOrgId(prisma, owner.email) } }),
    );
    expect(row.trialEndedAt).not.toBeNull();
    expect(row.trialEndedEmailSentAt).toBeNull();
  });

  test("after the trial the API refuses the 6th client invite", async () => {
    const invite = (email: string) =>
      owner.page.request.post(`${API}/auth/organization/invite-member`, {
        data: { email, role: "member" },
        headers: { Origin: WEB },
      });
    for (let i = 1; i <= 5; i++) {
      const res = await invite(`client-${i}-${Date.now()}@test.local`);
      expect(res.ok(), `invite ${i}: ${await res.text()}`).toBe(true);
    }
    const sixth = await invite(`client-6-${Date.now()}@test.local`);
    expect(sixth.status()).toBe(403);
    expect(await sixth.text()).toContain("clients limit (5/5)");
    // Team members have their own limit (Free: 1 admin); clients above don't eat into it.
    const admin = (email: string) =>
      owner.page.request.post(`${API}/auth/organization/invite-member`, {
        data: { email, role: "admin" },
        headers: { Origin: WEB },
      });
    const firstAdmin = await admin(`admin-1-${Date.now()}@test.local`);
    expect(firstAdmin.ok(), await firstAdmin.text()).toBe(true);
    const secondAdmin = await admin(`admin-2-${Date.now()}@test.local`);
    expect(secondAdmin.status()).toBe(403);
    expect(await secondAdmin.text()).toContain("team members limit (1/1)");
    // Pro tags are gone too: the features are locked now, not previewed.
    await owner.page.goto(`${WEB}/dashboard/settings/payments`);
    await expect(owner.page.getByTestId("payments-locked")).toBeVisible({ timeout: 15000 });
    await expect(owner.page.getByTestId("trial-tag")).toHaveCount(0);
  });

  test("the trial banner is gone once the trial has ended", async () => {
    await owner.page.goto(`${WEB}/dashboard`);
    await expect(owner.page.getByRole("heading").first()).toBeVisible({ timeout: 15000 });
    await expect(owner.page.getByTestId("trial-banner")).toHaveCount(0);
  });
});
