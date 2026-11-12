import { test, expect } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Hosted owners are offered a plan at three moments: an early offer (first
// client invite, or coming back on a later day), a usage card after a few days
// of use, and a screen when the trial ends. Self-hosted installs never see them.

const API = "http://localhost:3001/api";
const WEB = "http://localhost:3000";
const DAY_MS = 24 * 60 * 60 * 1000;

interface Owner {
  context: BrowserContext;
  page: Page;
  email: string;
  csrf: string;
}

type Prisma = import("@prisma/client").PrismaClient;

/** Run a query against the local database, which owns trial and offer state. */
async function withDb<T>(fn: (prisma: Prisma) => Promise<T>): Promise<T> {
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

async function signUpOwner(browser: Browser): Promise<Owner> {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  const email = `offers-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const res = await page.request.post(`${API}/onboarding/signup`, {
    data: { name: "Offer Owner", email, password: "OfferPass123!", orgName: `Offer Org ${Date.now()}` },
  });
  if (!res.ok()) throw new Error(`Signup failed (${res.status()}): ${await res.text()}`);
  await page.request.get(`${API}/setup/status`);
  const csrf: string = (await context.cookies()).find((c) => c.name === "csrf-token")?.value ?? "";
  await page.request.post(`${API}/setup/complete`, { headers: { "x-csrf-token": csrf } });
  return { context, page, email, csrf };
}

/** Pretend the workspace was created `days` ago, so today is a return visit. */
async function backdateSignup(email: string, days: number): Promise<void> {
  await withDb(async (prisma) => {
    await prisma.organization.update({
      where: { id: await ownerOrgId(prisma, email) },
      data: { createdAt: new Date(Date.now() - days * DAY_MS) },
    });
  });
}

const offer = (page: Page) => page.getByTestId("plan-offer");

test.describe("plan offers (hosted)", () => {
  test.beforeEach(async ({ request }) => {
    const config: { billingEnabled: boolean } = await (await request.get(`${API}/health/config`)).json();
    test.skip(!config.billingEnabled, "Plan offers only exist when billing is enabled");
  });

  test("a brand-new owner sees no offer on signup day", async ({ browser }) => {
    const owner = await signUpOwner(browser);
    await owner.page.goto("/dashboard");
    await expect(owner.page.getByTestId("trial-banner")).toBeVisible();
    await expect(offer(owner.page)).toHaveCount(0);
    await owner.context.close();
  });

  test("inviting a client brings up the plan offer once", async ({ browser }) => {
    const owner = await signUpOwner(browser);
    const contact = await owner.page.request.post(`${API}/contacts`, {
      headers: { "x-csrf-token": owner.csrf },
      data: { name: "Casey Client", email: `client-${Date.now()}@test.local` },
    });
    expect(contact.ok()).toBe(true);
    const { id } = (await contact.json()) as { id: string };

    await owner.page.goto(`/dashboard/contacts/${id}`);
    await owner.page.getByRole("button", { name: "Invite to portal" }).click();
    await owner.page.getByRole("button", { name: "Send invite" }).click();

    await expect(offer(owner.page)).toBeVisible();
    await expect(offer(owner.page).getByRole("heading", { name: "Choose your plan" })).toBeVisible();
    await expect(offer(owner.page).getByText(/seats|Sold out/).first()).toBeVisible();
    await offer(owner.page).getByRole("button", { name: "Keep my free trial" }).click();
    await expect(offer(owner.page)).toHaveCount(0);

    await owner.page.reload();
    await expect(owner.page.getByTestId("trial-banner")).toBeVisible();
    await expect(offer(owner.page)).toHaveCount(0);
    await owner.context.close();
  });

  test("coming back on a later day brings up the plan offer", async ({ browser }) => {
    const owner = await signUpOwner(browser);
    await backdateSignup(owner.email, 1);
    await owner.page.goto("/dashboard");
    await expect(offer(owner.page)).toBeVisible();
    await owner.context.close();
  });

  test("after a few days of use the owner gets the usage card, once", async ({ browser }) => {
    const owner = await signUpOwner(browser);
    await backdateSignup(owner.email, 4);
    const yesterday: string = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
    await withDb(async (prisma) => {
      const organizationId = await ownerOrgId(prisma, owner.email);
      await prisma.planOffer.create({
        data: {
          organizationId,
          activeDays: 2,
          lastActiveDay: yesterday,
          lastOfferDay: yesterday,
          earlyShownAt: new Date(Date.now() - 2 * DAY_MS),
          earlyOutcome: "dismissed",
        },
      });
    });

    await owner.page.goto("/dashboard");
    const card = owner.page.getByTestId("usage-offer");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Keep Pro for $29/mo");
    await expect(offer(owner.page)).toHaveCount(0);
    await card.getByRole("button", { name: "Dismiss" }).click();
    await expect(card).toHaveCount(0);

    await owner.page.reload();
    await expect(owner.page.getByTestId("trial-banner")).toBeVisible();
    await expect(owner.page.getByTestId("usage-offer")).toHaveCount(0);
    await owner.context.close();
  });

  test("when the trial ends the owner sees it once, then continues on Free", async ({ browser }) => {
    const owner = await signUpOwner(browser);
    await withDb(async (prisma) => {
      await prisma.subscription.update({
        where: { organizationId: await ownerOrgId(prisma, owner.email) },
        data: { currentPeriodEnd: new Date(Date.now() - 60_000) },
      });
    });

    await owner.page.goto("/dashboard");
    await expect(offer(owner.page).getByRole("heading", { name: "Your Pro trial has ended" })).toBeVisible();
    await offer(owner.page).getByRole("button", { name: "Continue on Free" }).click();
    await expect(offer(owner.page)).toHaveCount(0);

    await owner.page.reload();
    await expect(owner.page.getByRole("heading").first()).toBeVisible();
    await expect(offer(owner.page)).toHaveCount(0);
    await owner.context.close();
  });

  test("an admin never gets an offer", async ({ browser }) => {
    const owner = await signUpOwner(browser);
    await backdateSignup(owner.email, 2);
    const admin = await signUpOwner(browser);
    const orgId: string = await withDb(async (prisma) => {
      const organizationId = await ownerOrgId(prisma, owner.email);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: admin.email } });
      await prisma.member.create({
        data: { id: `adm-${Date.now()}`, organizationId, userId: user.id, role: "admin", createdAt: new Date() },
      });
      return organizationId;
    });

    // Better Auth routes check Origin rather than the CSRF token.
    const switched = await admin.page.request.post(`${API}/auth/organization/set-active`, {
      headers: { Origin: WEB },
      data: { organizationId: orgId },
    });
    expect(switched.ok(), await switched.text()).toBe(true);
    expect((await admin.page.request.get(`${API}/plan-offers/due`)).status()).toBe(403);

    await admin.page.goto("/dashboard");
    await expect(admin.page.getByRole("heading").first()).toBeVisible();
    await expect(offer(admin.page)).toHaveCount(0);
    await owner.context.close();
    await admin.context.close();
  });
});

test.describe("plan offers (self-hosted)", () => {
  test("an owner who invites a client and comes back never sees an offer", async ({ browser, request }) => {
    const config: { billingEnabled: boolean } = await (await request.get(`${API}/health/config`)).json();
    test.skip(config.billingEnabled, "Covers installs with billing off");

    const owner = await signUpOwner(browser);
    await backdateSignup(owner.email, 3);
    const invited = await owner.page.request.post(`${API}/auth/organization/invite-member`, {
      headers: { Origin: WEB },
      data: { email: `client-${Date.now()}@test.local`, role: "member" },
    });
    expect(invited.ok()).toBe(true);

    expect(await (await owner.page.request.get(`${API}/plan-offers/due`)).json()).toEqual({ offer: null, activity: null });
    await owner.page.goto("/dashboard");
    await expect(owner.page.getByRole("heading").first()).toBeVisible();
    await expect(offer(owner.page)).toHaveCount(0);
    const rows: number = await withDb(async (prisma) =>
      prisma.planOffer.count({ where: { organizationId: await ownerOrgId(prisma, owner.email) } }),
    );
    expect(rows).toBe(0);
    await owner.context.close();
  });
});
