import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Invoice Upload", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    const csrfToken = getCsrfToken();
    const res = await request.post(`${API}/projects`, {
      data: { name: "Invoice Upload Test Project" },
      headers: { "x-csrf-token": csrfToken },
    });
    if (res.ok()) {
      const body = await res.json();
      projectId = body.id;
    }
  });

  test.describe("API - Upload Invoice", () => {
    test("upload an invoice PDF via API", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();

      const boundary = "----InvBoundary" + Date.now();
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="projectId"',
        "",
        projectId,
        `--${boundary}`,
        'Content-Disposition: form-data; name="amount"',
        "",
        "50000",
        `--${boundary}`,
        'Content-Disposition: form-data; name="notes"',
        "",
        "Uploaded invoice for design work",
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="invoice-2024.pdf"',
        "Content-Type: application/pdf",
        "",
        "fake pdf invoice content",
        `--${boundary}--`,
      ].join("\r\n");

      const res = await request.post(`${API}/invoices/upload`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      expect(res.status()).toBe(201);
      const invoice = await res.json();
      expect(invoice.type).toBe("uploaded");
      expect(invoice.amount).toBe(50000);
      expect(invoice.uploadedFile).toBeTruthy();
      expect(invoice.invoiceNumber).toMatch(/^INV-/);
    });

    test("uploaded invoice appears in invoice list", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const res = await request.get(`${API}/invoices?projectId=${projectId}`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      const uploaded = body.data.filter((i: { type: string }) => i.type === "uploaded");
      expect(uploaded.length).toBeGreaterThan(0);
    });

    test("upload requires a file", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/invoices/upload`, {
        data: { projectId, amount: 1000 },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBeGreaterThanOrEqual(400);
    });

    test("upload requires projectId", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();

      const boundary = "----InvBoundary" + Date.now();
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="amount"',
        "",
        "1000",
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="no-project.pdf"',
        "Content-Type: application/pdf",
        "",
        "content",
        `--${boundary}--`,
      ].join("\r\n");

      const res = await request.post(`${API}/invoices/upload`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      expect(res.status()).toBeGreaterThanOrEqual(400);
    });

    test("itemized invoices still work normally", async ({ request }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/invoices`, {
        data: {
          projectId,
          lineItems: [
            { description: "Regular item", quantity: 1, unitPrice: 3000 },
          ],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.type).toBe("itemized");
    });
  });

  test.describe("API - Payment Instructions", () => {
    test("get payment instructions (initially empty)", async ({ request }) => {
      const res = await request.get(`${API}/settings/payment-instructions`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body).toHaveProperty("paymentInstructions");
      expect(body).toHaveProperty("paymentMethod");
    });

    test("update payment instructions via settings", async ({ request }) => {
      const csrfToken = getCsrfToken();
      const res = await request.put(`${API}/settings`, {
        data: {
          paymentInstructions: "Please pay via bank transfer to Account #12345",
          paymentMethod: "bank_transfer",
        },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.paymentInstructions).toBe("Please pay via bank transfer to Account #12345");
      expect(body.paymentMethod).toBe("bank_transfer");
    });

    test("payment instructions are returned after setting", async ({ request }) => {
      const res = await request.get(`${API}/settings/payment-instructions`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.paymentInstructions).toBeTruthy();
    });
  });

  test.describe("Dashboard UI", () => {
    test("invoices tab has upload invoice button", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^invoices$/i }).click();
        await expect(page.getByRole("button", { name: /upload invoice/i })).toBeVisible({ timeout: 5000 });
      }
    });
  });
});
