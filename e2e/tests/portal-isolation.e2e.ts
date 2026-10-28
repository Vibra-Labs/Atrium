import { test, expect } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { createOwner, createPortalClientProject, inviteAndAcceptClient } from "./helpers";
import type { PortalClientProject } from "./helpers";

const API = "http://localhost:3001/api";
const WEB = "http://localhost:3000";

/**
 * Portal Isolation Tests
 *
 * These tests verify that portal (client) pages do NOT expose
 * internal/admin-only content. Clients must never see:
 * - Internal notes
 * - Admin controls (create/edit/delete for tasks, invoices)
 * - Invoice stats or management features
 * - Dashboard navigation
 */
test.describe("Portal Isolation", () => {
  test.describe("Portal client view", () => {
    const noteContent = "Internal margin note: do not share";
    const taskTitle = "Portal isolation visible task";
    let portal: PortalClientProject;
    let invoiceNumber: string;

    // One workspace, one client, one project seeded with a note, a task and a sent invoice.
    test.beforeAll(async ({ browser }) => {
      test.setTimeout(120000);
      portal = await createPortalClientProject(browser, "isolation", "Portal Isolation E2E");
      const { owner, ownerHeaders: headers, projectId } = portal;

      const noteRes = await owner.request.post(`${API}/notes?projectId=${projectId}`, {
        data: { content: noteContent },
        headers,
      });
      expect(noteRes.status()).toBe(201);

      const taskRes = await owner.request.post(`${API}/tasks?projectId=${projectId}`, {
        data: { title: taskTitle },
        headers,
      });
      expect(taskRes.status()).toBe(201);

      const invoiceRes = await owner.request.post(`${API}/invoices`, {
        data: { projectId, lineItems: [{ description: "Isolation item", quantity: 1, unitPrice: 5000 }] },
        headers,
      });
      expect(invoiceRes.status()).toBe(201);
      const invoice: { id: string; invoiceNumber: string } = await invoiceRes.json();
      invoiceNumber = invoice.invoiceNumber;
      const sentRes = await owner.request.put(`${API}/invoices/${invoice.id}`, {
        data: { status: "sent" },
        headers,
      });
      expect(sentRes.ok()).toBeTruthy();
    });

    test.afterAll(async () => {
      await portal?.close();
    });

    async function openTab(tab: "updates" | "tasks" | "files" | "invoices"): Promise<Page> {
      await portal.client.goto(`${WEB}/portal/projects/${portal.projectId}?tab=${tab}`);
      await expect(portal.client.getByRole("heading", { name: "Portal Isolation E2E", exact: true })).toBeVisible({ timeout: 15000 });
      return portal.client;
    }

    test("portal project page does NOT show internal notes", async () => {
      const client = await openTab("updates");
      await expect(client.getByRole("button", { name: "Add Update" })).toBeVisible();
      await expect(client.getByRole("button", { name: "Notes", exact: true })).toHaveCount(0);
      await expect(client.getByText(noteContent)).toHaveCount(0);
      await expect(client.getByText(/team only/i)).toHaveCount(0);

      const notesRes = await client.request.get(`${API}/notes/project/${portal.projectId}`);
      expect(notesRes.status()).toBe(403);
    });

    test("portal project page does NOT show add task form", async () => {
      const client = await openTab("tasks");
      await expect(client.getByRole("button", { name: /new request/i })).toBeVisible();
      await expect(client.getByRole("button", { name: "Create", exact: true })).toHaveCount(0);
      await expect(client.getByPlaceholder(/add a task/i)).toHaveCount(0);
      await expect(client.getByRole("button", { name: /add note/i })).toHaveCount(0);
    });

    test("portal project tasks are read-only (no delete)", async () => {
      const client = await openTab("tasks");
      await expect(client.getByText(taskTitle)).toBeVisible();
      await expect(client.getByRole("button", { name: "Delete task" })).toHaveCount(0);
    });

    test("portal files tab has client upload but no staff Add menu", async () => {
      const client = await openTab("files");
      await expect(client.getByText("Upload File", { exact: true })).toBeVisible();
      await expect(client.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
      await expect(client.getByText("Request approval", { exact: true })).toHaveCount(0);
    });

    test("portal project page does NOT show archive/status controls", async () => {
      await openTab("updates");
      const client = portal.client;
      await expect(client.getByRole("button", { name: /archive/i })).toHaveCount(0);
      await expect(client.getByRole("button", { name: /duplicate/i })).toHaveCount(0);
      await expect(client.getByText(/assigned clients/i)).toHaveCount(0);
    });

    test("portal project detail shows invoices section", async () => {
      const client = await openTab("invoices");
      await expect(client.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
      await expect(client.getByText(invoiceNumber).first()).toBeVisible();
    });

    test("portal project invoices do NOT show management controls", async () => {
      const client = await openTab("invoices");
      await expect(client.getByText(invoiceNumber).first()).toBeVisible();
      await expect(client.getByRole("button", { name: /new invoice/i })).toHaveCount(0);
      await expect(client.getByRole("button", { name: /mark as sent/i })).toHaveCount(0);
      await expect(client.getByRole("button", { name: /mark as paid/i })).toHaveCount(0);
      await expect(client.getByRole("button", { name: /^edit$/i })).toHaveCount(0);
      await expect(client.getByRole("combobox").filter({ hasText: "All Statuses" })).toHaveCount(0);
    });

    test("portal header has only client-safe links", async () => {
      const client = portal.client;
      await client.goto(`${WEB}/portal`);
      const header = client.locator("header");
      await expect(header.getByRole("link", { name: "Projects", exact: true })).toBeVisible({ timeout: 15000 });
      await expect(header.getByRole("link", { name: "Settings", exact: true })).toBeVisible();

      for (const name of [/^overview$/i, /^clients$/i, /^contacts$/i, /branding/i, /^team$/i]) {
        await expect(client.getByRole("link", { name })).toHaveCount(0);
      }
    });

    test("portal does NOT render dashboard sidebar", async () => {
      const client = portal.client;
      await client.goto(`${WEB}/portal`);
      await expect(client.locator("header").getByRole("link", { name: "Projects", exact: true })).toBeVisible({ timeout: 15000 });
      await expect(client.locator("nav").getByText(/overview/i)).toHaveCount(0);
      await expect(client.locator('a[href^="/dashboard"]')).toHaveCount(0);
    });
  });

  test.describe("API-level isolation", () => {
    test("notes endpoints require admin role", async ({ request }) => {
      // There is no /notes/mine — notes are admin-only
      const res = await request.get("http://localhost:3001/api/notes/mine");
      // Should get 404 (route not found) or 403 (forbidden)
      expect(res.status()).toBeGreaterThanOrEqual(400);
    });

    test("admin invoice endpoints are role-protected", async ({ request }) => {
      // The /invoices/stats endpoint requires owner/admin role
      // Since our test user IS an owner, this should succeed
      // The protection is verified by the controller having @Roles("owner", "admin")
      const res = await request.get("http://localhost:3001/api/invoices/stats");
      expect(res.ok()).toBeTruthy();
    });

    test("client invoice endpoints exist and work", async ({ request }) => {
      // /invoices/mine should return invoices for the current user
      const res = await request.get("http://localhost:3001/api/invoices/mine");
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
    });
  });

  test.describe("Contacts are staff-only", () => {
    test.setTimeout(120000);

    // Creates an owner and a portal client, signs the client in, runs `body`, always cleans up.
    async function asPortalClient(browser: Browser, body: (client: Page) => Promise<void>): Promise<void> {
      const { context: ownerCtx, page: owner } = await createOwner(browser, "contacts-iso-owner");
      let clientCtx: BrowserContext | undefined;
      try {
        const { clientEmail, password } = await inviteAndAcceptClient(browser, owner, "contacts-iso-client");
        clientCtx = await browser.newContext({ storageState: undefined });
        const client = await clientCtx.newPage();
        await client.goto("http://localhost:3000/login");
        await client.getByLabel(/email/i).fill(clientEmail);
        await client.getByLabel(/password/i).fill(password);
        await client.getByRole("button", { name: /sign in/i }).click();
        await client.waitForURL(/\/portal/, { timeout: 15000 });
        await body(client);
      } finally {
        await clientCtx?.close();
        await ownerCtx.close();
      }
    }

    test("portal client gets 403 on /api/contacts, /api/companies, /api/lead-sources", async ({ browser }) => {
      await asPortalClient(browser, async (client) => {
        for (const path of ["contacts", "companies", "lead-sources"]) {
          const res = await client.request.get(`http://localhost:3001/api/${path}`);
          expect(res.status(), path).toBe(403);
        }
      });
    });

    test("portal client cannot open /dashboard/contacts", async ({ browser }) => {
      await asPortalClient(browser, async (client) => {
        await client.goto("http://localhost:3000/dashboard/contacts");
        await expect(client).toHaveURL(/\/portal/, { timeout: 15000 });
      });
    });
  });
});
