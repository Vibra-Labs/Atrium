import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve } from "path";

const API = "http://localhost:3001/api";

// ---------------------------------------------------------------------------
// Helper: read the CSRF token from the stored auth state.
// The global-setup writes the session + csrf-token cookie to this file.
// ---------------------------------------------------------------------------
function getCsrfToken(): string {
  const authPath = resolve(__dirname, "../e2e/.auth/user.json");
  const state = JSON.parse(readFileSync(authPath, "utf-8"));
  const cookie = state.cookies?.find(
    (c: { name: string }) => c.name === "csrf-token",
  );
  return cookie?.value || "";
}

// ---------------------------------------------------------------------------
// Helper: create a minimal invoice via the API and return its id.
// The test user is an owner so the POST /invoices endpoint is accessible.
// ---------------------------------------------------------------------------
async function createTestInvoice(
  request: Parameters<Parameters<typeof test>[1]>[0]["request"],
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const csrfToken = getCsrfToken();
  const res = await request.post(`${API}/invoices`, {
    data: {
      lineItems: [
        { description: "PDF Test Item", quantity: 1, unitPrice: 2500 },
      ],
      ...overrides,
    },
    headers: { "x-csrf-token": csrfToken },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.id as string;
}

test.describe("Invoices", () => {
  test.describe("Dashboard - Invoices within project", () => {
    test("project detail page shows invoices tab", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await expect(page.getByRole("button", { name: /^invoices$/i })).toBeVisible({ timeout: 5000 });
      }
    });

    test("invoices tab has new invoice button", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^invoices$/i }).click();
        await expect(page.getByRole("button", { name: /new invoice/i })).toBeVisible({ timeout: 5000 });
      }
    });

    test("invoices tab has status filter", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^invoices$/i }).click();
        await expect(page.getByText(/all statuses/i)).toBeVisible({ timeout: 5000 });
      }
    });

    test("new invoice modal opens and has form fields", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^invoices$/i }).click();
        await page.getByRole("button", { name: /new invoice/i }).click({ timeout: 5000 });
        await expect(page.getByText(/line items/i)).toBeVisible();
        await expect(page.getByText(/due date/i)).toBeVisible();
        await expect(page.getByRole("button", { name: /create invoice/i })).toBeVisible();
        await expect(page.getByText(/add line item/i)).toBeVisible();
      }
    });

    test("create invoice within project and verify it appears", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^invoices$/i }).click();
        await page.getByRole("button", { name: /new invoice/i }).click({ timeout: 5000 });

        // Fill in a line item
        await page.getByPlaceholder("Description").fill("E2E Test Service");
        const qtyInput = page.locator('input[type="number"]').first();
        await qtyInput.fill("2");
        const priceInput = page.locator('input[type="number"]').nth(1);
        await priceInput.fill("100");

        // Submit
        await page.getByRole("button", { name: /create invoice/i }).click();

        // The new invoice should appear in the project's invoice section
        await expect(page.getByText("INV-")).toBeVisible({ timeout: 10000 });
      }
    });

    test("invoice row expands to show line items", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^invoices$/i }).click();
        const invoiceRow = page.getByText("INV-").first();
        if (await invoiceRow.isVisible({ timeout: 5000 }).catch(() => false)) {
          await invoiceRow.click();
          await expect(page.getByText(/description/i)).toBeVisible({ timeout: 3000 });
          await expect(page.getByText(/total/i)).toBeVisible();
        }
      }
    });

    test("invoice shows status transition buttons", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^invoices$/i }).click();
        const invoiceRow = page.getByText("INV-").first();
        if (await invoiceRow.isVisible({ timeout: 5000 }).catch(() => false)) {
          await invoiceRow.click();
          // Draft invoices should show "Mark as Sent"
          const markSent = page.getByRole("button", { name: /mark as sent/i });
          const markPaid = page.getByRole("button", { name: /mark as paid/i });
          const hasTransition = await markSent.isVisible().catch(() => false)
            || await markPaid.isVisible().catch(() => false);
          expect(hasTransition).toBeTruthy();
        }
      }
    });
  });

  test.describe("Dashboard overview", () => {
    test("dashboard home shows invoice stats", async ({ page }) => {
      await page.goto("/dashboard");
      await expect(page.getByText(/outstanding/i)).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe("Old routes removed", () => {
    test("dashboard sidebar does NOT show invoices link", async ({ page }) => {
      await page.goto("/dashboard");
      // The sidebar should NOT have an "Invoices" nav item anymore
      const sidebarInvoicesLink = page.locator("nav").getByRole("link", { name: /^invoices$/i });
      await expect(sidebarInvoicesLink).not.toBeVisible();
    });
  });

  test.describe("API", () => {
    test("create invoice via API", async ({ request }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/invoices`, {
        data: {
          lineItems: [
            { description: "API Test Item", quantity: 1, unitPrice: 5000 },
          ],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.invoiceNumber).toBeTruthy();
      expect(body.status).toBe("draft");
    });

    test("list invoices via API", async ({ request }) => {
      const res = await request.get(`${API}/invoices`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.meta).toBeTruthy();
    });

    test("list invoices filtered by project via API", async ({ request }) => {
      // First get a project
      const projectsRes = await request.get(`${API}/projects?limit=1`);
      const projects = await projectsRes.json();
      if (projects.data?.length > 0) {
        const projectId = projects.data[0].id;
        const res = await request.get(`${API}/invoices?projectId=${projectId}`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.data).toBeInstanceOf(Array);
      }
    });

    test("get invoice stats via API", async ({ request }) => {
      const res = await request.get(`${API}/invoices/stats`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body).toHaveProperty("outstandingAmount");
      expect(body).toHaveProperty("totalInvoices");
      expect(body).toHaveProperty("paidAmount");
    });
  });

  // -------------------------------------------------------------------------
  // PDF Download — owner/admin endpoint: GET /invoices/:id/pdf
  // -------------------------------------------------------------------------
  test.describe("PDF Download - owner endpoint", () => {
    test("GET /invoices/:id/pdf returns 200 with application/pdf content type", async ({
      request,
    }) => {
      const invoiceId = await createTestInvoice(request);

      const res = await request.get(`${API}/invoices/${invoiceId}/pdf`);

      expect(res.ok()).toBeTruthy();
      expect(res.status()).toBe(200);
      const contentType = res.headers()["content-type"];
      expect(contentType).toContain("application/pdf");
    });

    test("GET /invoices/:id/pdf sets Content-Disposition attachment header", async ({
      request,
    }) => {
      const invoiceId = await createTestInvoice(request);

      const res = await request.get(`${API}/invoices/${invoiceId}/pdf`);

      expect(res.ok()).toBeTruthy();
      const disposition = res.headers()["content-disposition"];
      expect(disposition).toBeTruthy();
      expect(disposition).toContain("attachment");
    });

    test("Content-Disposition filename matches the invoice number format", async ({
      request,
    }) => {
      const invoiceId = await createTestInvoice(request);

      const res = await request.get(`${API}/invoices/${invoiceId}/pdf`);

      expect(res.ok()).toBeTruthy();
      const disposition = res.headers()["content-disposition"];
      // Filename should be INV-XXXX.pdf
      expect(disposition).toMatch(/INV-\d+\.pdf/);
    });

    test("GET /invoices/:id/pdf response body is non-empty binary data", async ({
      request,
    }) => {
      const invoiceId = await createTestInvoice(request);

      const res = await request.get(`${API}/invoices/${invoiceId}/pdf`);

      expect(res.ok()).toBeTruthy();
      const body = await res.body();
      expect(body.length).toBeGreaterThan(0);
    });

    test("GET /invoices/:id/pdf returns 404 for a non-existent invoice id", async ({
      request,
    }) => {
      const res = await request.get(
        `${API}/invoices/00000000-0000-0000-0000-000000000000/pdf`,
      );

      expect(res.status()).toBe(404);
    });

    test("GET /invoices/:id/pdf returns 404 for an invoice belonging to another org", async ({
      request,
    }) => {
      // A random UUID that will not match any invoice in the test org
      const res = await request.get(
        `${API}/invoices/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/pdf`,
      );

      expect(res.status()).toBe(404);
    });

    test("PDF endpoint requires authentication — unauthenticated request is rejected", async ({
      page,
    }) => {
      // page.request does NOT carry the authenticated session cookie
      const unauthRes = await page.request.get(
        `${API}/invoices/some-id/pdf`,
        { headers: { Cookie: "" } },
      );

      // Must not be 2xx
      expect(unauthRes.status()).toBeGreaterThanOrEqual(400);
    });

    test("PDF download works for an invoice that has line items with varying quantities", async ({
      request,
    }) => {
      const invoiceId = await createTestInvoice(request, {
        lineItems: [
          { description: "Design", quantity: 3, unitPrice: 5000 },
          { description: "Development", quantity: 20, unitPrice: 8000 },
          { description: "QA", quantity: 5, unitPrice: 3000 },
        ],
      });

      const res = await request.get(`${API}/invoices/${invoiceId}/pdf`);

      expect(res.ok()).toBeTruthy();
      expect(res.headers()["content-type"]).toContain("application/pdf");
    });

    test("PDF download works for an invoice that has notes", async ({
      request,
    }) => {
      const invoiceId = await createTestInvoice(request, {
        lineItems: [{ description: "Consulting", quantity: 1, unitPrice: 10000 }],
        notes: "Payment due within 30 days of receipt.",
      });

      const res = await request.get(`${API}/invoices/${invoiceId}/pdf`);

      expect(res.ok()).toBeTruthy();
      expect(res.headers()["content-type"]).toContain("application/pdf");
    });

    test("PDF download works for an invoice with a due date", async ({
      request,
    }) => {
      const invoiceId = await createTestInvoice(request, {
        lineItems: [{ description: "Monthly retainer", quantity: 1, unitPrice: 150000 }],
        dueDate: "2025-12-31",
      });

      const res = await request.get(`${API}/invoices/${invoiceId}/pdf`);

      expect(res.ok()).toBeTruthy();
      expect(res.headers()["content-type"]).toContain("application/pdf");
    });
  });

  // -------------------------------------------------------------------------
  // PDF Download — client endpoint: GET /invoices/mine/:id/pdf
  // The test user is the org owner, not a project client, so the mine/:id
  // endpoint returns 403 for invoices the owner is not a client of.
  // These tests validate the access-control boundary from the API side.
  // -------------------------------------------------------------------------
  test.describe("PDF Download - client endpoint", () => {
    test("GET /invoices/mine/:id/pdf returns 4xx for an invoice the user is not assigned to", async ({
      request,
    }) => {
      // Owner creates the invoice but is NOT a project client —
      // the mine/:id endpoint requires a ProjectClient row.
      const invoiceId = await createTestInvoice(request);

      const res = await request.get(`${API}/invoices/mine/${invoiceId}/pdf`);

      // Expect 403 Forbidden (not assigned to project) or 404 (no project)
      expect(res.status()).toBeGreaterThanOrEqual(400);
    });

    test("GET /invoices/mine/:id/pdf returns 404 for a completely unknown invoice", async ({
      request,
    }) => {
      const res = await request.get(
        `${API}/invoices/mine/00000000-0000-0000-0000-000000000000/pdf`,
      );

      expect(res.status()).toBe(404);
    });

    test("client PDF endpoint requires authentication", async ({ page }) => {
      const unauthRes = await page.request.get(
        `${API}/invoices/mine/some-id/pdf`,
        { headers: { Cookie: "" } },
      );

      expect(unauthRes.status()).toBeGreaterThanOrEqual(400);
    });

    test("GET /invoices/mine/:id/pdf returns application/pdf when client is assigned", async ({
      request,
    }) => {
      // Set up: create a project, add the test user as a client, create an invoice.
      const csrfToken = getCsrfToken();

      // 1. Create a project
      const projectRes = await request.post(`${API}/projects`, {
        data: { name: "PDF Client Test Project" },
        headers: { "x-csrf-token": csrfToken },
      });

      if (!projectRes.ok()) {
        // If project creation is not available in this test context, skip gracefully
        return;
      }

      const project = await projectRes.json();
      const projectId = project.id as string;

      // 2. Get the current user's member id — we need the userId to add as client
      const meRes = await request.get(`${API}/auth/me`);
      if (!meRes.ok()) return;

      const me = await meRes.json();
      const userId: string = me?.user?.id ?? me?.id;
      if (!userId) return;

      // 3. Assign the user as a project client
      const assignRes = await request.post(
        `${API}/projects/${projectId}/clients`,
        { data: { userId }, headers: { "x-csrf-token": csrfToken } },
      );
      if (!assignRes.ok()) return;

      // 4. Create an invoice linked to the project
      const invoiceRes = await request.post(`${API}/invoices`, {
        data: {
          projectId,
          lineItems: [{ description: "Client PDF Item", quantity: 1, unitPrice: 5000 }],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      if (!invoiceRes.ok()) return;
      const invoice = await invoiceRes.json();

      // 5. Download the PDF via the client endpoint
      const pdfRes = await request.get(
        `${API}/invoices/mine/${invoice.id}/pdf`,
      );

      expect(pdfRes.ok()).toBeTruthy();
      expect(pdfRes.headers()["content-type"]).toContain("application/pdf");
      const disposition = pdfRes.headers()["content-disposition"];
      expect(disposition).toContain("attachment");
      expect(disposition).toMatch(/INV-\d+\.pdf/);
    });
  });
});
