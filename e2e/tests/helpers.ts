import { readFileSync, existsSync } from "fs";
import { createRequire } from "module";
import { resolve } from "path";
import { expect } from "@playwright/test";
import type { APIRequestContext, Browser, BrowserContext, Locator, Page } from "@playwright/test";

const API = "http://localhost:3001/api";
const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";

const SEARCH_PLACEHOLDER = /search projects, tasks, files, people/i;

/**
 * Open the global search palette and return its input.
 *
 * The Cmd+K handler is registered in a `useEffect`, so it does not exist until
 * React has hydrated. A single press right after `goto` is silently dropped if
 * it lands first, which made these tests flaky. Retry the press until the
 * palette actually opens rather than assuming the first one registers.
 */
export async function openSearchPalette(page: Page): Promise<Locator> {
  const input = page.getByPlaceholder(SEARCH_PLACEHOLDER);
  await expect(async () => {
    await page.keyboard.press("Meta+k");
    await expect(input).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  return input;
}

/**
 * Read the CSRF token from the stored auth state file written by global-setup.
 * This is used by tests that make API calls via the `request` fixture (which
 * carries cookies from stored state but does NOT automatically set the
 * x-csrf-token header).
 */
export function getCsrfToken(): string {
  // The global-setup writes to "e2e/.auth/user.json" (relative to repo root).
  // Depending on cwd, the file could be at either of these paths.
  const candidates = [
    resolve(__dirname, "../.auth/user.json"),
    resolve(__dirname, "../e2e/.auth/user.json"),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      const state = JSON.parse(readFileSync(p, "utf-8"));
      const cookie = state.cookies?.find(
        (c: { name: string }) => c.name === "csrf-token",
      );
      return cookie?.value || "";
    }
  }

  return "";
}

/**
 * Read the CSRF token from a live browser context's cookies.
 * Use this for tests that create fresh contexts (e.g. browser.newContext())
 * where the stored auth state is not applicable.
 */
export async function getCsrfTokenFromContext(
  context: BrowserContext,
): Promise<string> {
  const cookies = await context.cookies();
  const cookie = cookies.find((c) => c.name === "csrf-token");
  return cookie?.value || "";
}

/**
 * Get or create a project by name. The Free plan caps orgs at 2 projects, so
 * tests must reuse projects by name when possible.
 */
export async function getOrCreateProject(
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const listRes = await request.get(`${API}/projects?limit=100`);
  if (listRes.ok()) {
    const list = await listRes.json();
    const items: { id: string; name: string }[] = Array.isArray(list)
      ? list
      : (list.data ?? []);
    const found = items.find((p) => p.name === name);
    if (found) return found.id;
  }
  const csrfToken = getCsrfToken();
  const res = await request.post(`${API}/projects`, {
    data: { name },
    headers: { "x-csrf-token": csrfToken },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `Failed to create project (${res.status()}): ${body.slice(0, 200)}`,
    );
  }
  const body = await res.json();
  return body.id as string;
}

export async function createTask(
  request: APIRequestContext,
  projectId: string,
  title: string,
  dueDate: Date,
): Promise<string> {
  const csrfToken = getCsrfToken();
  const res = await request.post(`${API}/tasks?projectId=${projectId}`, {
    data: { title, dueDate: dueDate.toISOString() },
    headers: { "x-csrf-token": csrfToken },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `Failed to create task (${res.status()}): ${body.slice(0, 200)}`,
    );
  }
  const body = await res.json();
  return body.id as string;
}

export type PlanFeatureMap = Record<
  "custom_domain" | "e_signatures" | "integrations" | "online_payments" | "white_label",
  boolean
>;

/**
 * Which Pro features the test workspace can use. Everything is true when
 * billing is off (CI, self-hosted); on a hosted Free plan the gates are false.
 */
export async function getPlanFeatures(request: APIRequestContext): Promise<PlanFeatureMap> {
  const res = await request.get(`${API}/billing/features`);
  expect(res.ok()).toBe(true);
  const body: { features: PlanFeatureMap } = await res.json();
  return body.features;
}

export async function createOwner(browser: Browser, prefix = "vac-owner"): Promise<{
  context: BrowserContext;
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

export async function inviteAndAcceptClient(
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
  await clientPage.getByRole("button", { name: /use a password instead/i }).click();
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

/** The id of the contact with this email in the page's workspace (portal clients have one). */
export async function contactIdByEmail(page: Page, email: string): Promise<string> {
  const res = await page.request.get(`${API}/contacts?search=${encodeURIComponent(email)}`);
  expect(res.ok()).toBe(true);
  const body: { data: { id: string; email: string | null }[] } = await res.json();
  const contact = body.data.find((c) => c.email === email.toLowerCase());
  if (!contact) throw new Error(`No contact for ${email}`);
  return contact.id;
}

/** Opens the contact page of the client with this email (where portal access is managed). */
export async function openClientContact(page: Page, email: string): Promise<void> {
  const id: string = await contactIdByEmail(page, email);
  await page.goto(`${WEB_URL}/dashboard/contacts/${id}`, { waitUntil: "networkidle", timeout: 15000 });
}

/** Signs in an existing user in a fresh browser context. */
export async function signIn(
  browser: Browser,
  email: string,
  password: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context: BrowserContext = await browser.newContext({ storageState: undefined });
  const page: Page = await context.newPage();
  await page.goto(`${WEB_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(portal|dashboard)/, { timeout: 20000 });
  return { context, page };
}

/** Contacts list: Filter → category → value, as a user picks it. */
export async function applyContactFilter(page: Page, category: string, value: string): Promise<void> {
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("menuitem", { name: category }).click();
  await page.getByRole("menuitemradio", { name: value }).click();
}

export type ProjectTab = "updates" | "tasks" | "files" | "time" | "invoices" | "notes";

/** Opens a dashboard project straight on one tab (the page honours ?tab=). */
export async function openProjectTab(page: Page, projectId: string, tab: ProjectTab): Promise<void> {
  await page.goto(`${WEB_URL}/dashboard/projects/${projectId}?tab=${tab}`);
  await expect(page.getByTestId(`project-tab-${tab}`)).toBeVisible({ timeout: 15000 });
}

export interface PortalClientProject {
  owner: Page;
  ownerHeaders: Record<string, string>;
  client: Page;
  clientEmail: string;
  projectId: string;
  close: () => Promise<void>;
}

/**
 * A fresh workspace with one portal client signed in and one project that
 * client is assigned to. Portal tests use this instead of whatever project
 * happens to be listed first. Call `close()` when done.
 */
export async function createPortalClientProject(
  browser: Browser,
  prefix: string,
  projectName: string,
): Promise<PortalClientProject> {
  const { context: ownerContext, page: owner } = await createOwner(browser, `${prefix}-owner`);
  const { clientEmail, password } = await inviteAndAcceptClient(browser, owner, `${prefix}-client`);
  const ownerHeaders: Record<string, string> = {
    "x-csrf-token": await getCsrfTokenFromContext(ownerContext),
  };

  const clientsRes = await owner.request.get(`${API}/clients?limit=100`);
  expect(clientsRes.ok()).toBe(true);
  const clientsBody: { data: { userId: string; user: { email: string } }[] } = await clientsRes.json();
  const clientRow = clientsBody.data.find((m) => m.user.email === clientEmail);
  if (!clientRow) throw new Error(`Client ${clientEmail} not found in /clients`);

  const projectRes = await owner.request.post(`${API}/projects`, {
    data: { name: projectName, clientUserIds: [clientRow.userId] },
    headers: ownerHeaders,
  });
  if (!projectRes.ok()) {
    throw new Error(`Project create failed (${projectRes.status()}): ${await projectRes.text()}`);
  }
  const project: { id: string } = await projectRes.json();

  const { context: clientContext, page: client } = await signIn(browser, clientEmail, password);

  return {
    owner,
    ownerHeaders,
    client,
    clientEmail,
    projectId: project.id,
    close: async (): Promise<void> => {
      await clientContext.close();
      await ownerContext.close();
    },
  };
}

/**
 * Gives the test workspace an email provider (an SMTP port nothing listens on),
 * so the login page offers "Email me a sign-in link" even where the server has
 * none, as in CI. Undo it with disableWorkspaceEmail.
 */
export async function enableWorkspaceEmail(request: APIRequestContext): Promise<void> {
  const res = await request.patch(`${API}/settings`, {
    data: { emailProvider: "smtp", smtpHost: "127.0.0.1", smtpPort: 1, emailFrom: "e2e@test.local" },
    headers: { "x-csrf-token": getCsrfToken() },
  });
  if (!res.ok()) throw new Error(`Enabling workspace email failed (${res.status()}): ${await res.text()}`);
}

export async function disableWorkspaceEmail(request: APIRequestContext): Promise<void> {
  const res = await request.patch(`${API}/settings`, {
    data: { emailProvider: null, smtpHost: null, smtpPort: null, emailFrom: null },
    headers: { "x-csrf-token": getCsrfToken() },
  });
  if (!res.ok()) throw new Error(`Disabling workspace email failed (${res.status()}): ${await res.text()}`);
}

/**
 * The newest magic link token issued for this address. Stands in for opening
 * the email: the token is stored in plain text in the verification table.
 */
export async function latestMagicLinkToken(email: string): Promise<string> {
  // Resolved from the database package, which owns the generated Prisma client.
  const requireFromDb = createRequire(resolve(__dirname, "../../packages/database/package.json"));
  const { PrismaClient } = requireFromDb("@prisma/client") as typeof import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const row = await prisma.verification.findFirst({
      where: { value: { contains: `"${email.toLowerCase()}"` } },
      orderBy: { createdAt: "desc" },
      select: { identifier: true },
    });
    if (!row) throw new Error(`No magic link issued for ${email}`);
    return row.identifier;
  } finally {
    await prisma.$disconnect();
  }
}
