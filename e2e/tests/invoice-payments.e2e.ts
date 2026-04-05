import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Invoice Payments", () => {
  // ── Settings UI ──

  test.describe("Settings page", () => {
    test("system settings shows Client Payments section", async ({ page }) => {
      await page.goto("/dashboard/settings/system");
      // Payments section is on the Payments tab
      await page.getByRole("button", { name: /^payments$/i }).click();
      await expect(
        page.getByRole("heading", { name: /client payments/i }),
      ).toBeVisible({ timeout: 5000 });
    });

    test("shows Stripe connection UI (direct key input or OAuth button)", async ({ page }) => {
      await page.goto("/dashboard/settings/system");
      await page.getByRole("button", { name: /^payments$/i }).click();
      // Direct mode shows sk_test_ input; Connect mode shows "Connect with Stripe" button
      const directInput = page.getByPlaceholder(/sk_test_/i);
      const connectBtn = page.getByRole("button", { name: /connect with stripe/i });
      await expect(directInput.or(connectBtn)).toBeVisible({ timeout: 5000 });
    });

    test("shows Stripe action button (Save & Connect or Connect with Stripe)", async ({ page }) => {
      await page.goto("/dashboard/settings/system");
      await page.getByRole("button", { name: /^payments$/i }).click();
      // Direct mode shows "Save & Connect"; Connect mode shows "Connect with Stripe"
      const saveConnect = page.getByRole("button", { name: /save.*connect/i });
      const connectStripe = page.getByRole("button", { name: /connect with stripe/i });
      await expect(saveConnect.or(connectStripe)).toBeVisible({ timeout: 5000 });
    });
  });

  // ── API: Payment status ──

  test.describe("API — Payment status", () => {
    test("GET /payments/status returns disabled with mode", async ({
      request,
    }) => {
      const res = await request.get(`${API}/payments/status`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.enabled).toBe(false);
      expect(body.mode).toBe("direct");
    });

    test("GET /payments/enabled returns enabled: false by default", async ({
      request,
    }) => {
      const res = await request.get(`${API}/payments/enabled`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.enabled).toBe(false);
    });

    test("GET /settings/payment-instructions returns stripeConnectEnabled field", async ({
      request,
    }) => {
      const res = await request.get(`${API}/settings/payment-instructions`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body).toHaveProperty("stripeConnectEnabled");
      expect(body.stripeConnectEnabled).toBe(false);
    });
  });

  // ── API: Direct keys validation ──

  test.describe("API — Direct keys", () => {
    test("POST /payments/direct/save-key rejects invalid key format", async ({
      request,
    }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/payments/direct/save-key`, {
        data: { stripeSecretKey: "pk_test_invalid_not_a_secret_key" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(400);
    });

    test("POST /payments/direct/save-key rejects too-short key", async ({
      request,
    }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/payments/direct/save-key`, {
        data: { stripeSecretKey: "sk_test_short" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(400);
    });

    test("POST /payments/direct/remove-key returns 400 when no key configured", async ({
      request,
    }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/payments/direct/remove-key`, {
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.message).toContain("No Stripe key configured");
    });
  });

  // ── API: Checkout guard ──

  test.describe("API — Checkout guard", () => {
    test("POST /payments/checkout/:id returns 400 when payments not configured", async ({
      request,
    }) => {
      const csrfToken = getCsrfToken();
      const invoiceRes = await request.post(`${API}/invoices`, {
        data: {
          lineItems: [
            { description: "Payment Test Item", quantity: 1, unitPrice: 5000 },
          ],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(invoiceRes.status()).toBe(201);
      const invoice = await invoiceRes.json();

      const res = await request.post(
        `${API}/payments/checkout/${invoice.id}`,
        {
          data: {
            successUrl: "http://localhost:3000/portal?payment=success",
            cancelUrl: "http://localhost:3000/portal",
          },
          headers: { "x-csrf-token": csrfToken },
        },
      );
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.message).toContain("not configured");
    });
  });

  // ── API: Webhook endpoints ──

  test.describe("API — Webhook endpoints", () => {
    test("POST /payments/webhook returns 400 when no connect secret configured", async ({
      request,
    }) => {
      const res = await request.post(`${API}/payments/webhook`, {
        headers: { "stripe-signature": "t=123,v1=abc" },
      });
      expect(res.status()).toBe(400);
    });

    test("POST /payments/webhook/:orgId returns 400 for unknown org", async ({
      request,
    }) => {
      const res = await request.post(
        `${API}/payments/webhook/nonexistent-org-id`,
        { headers: { "stripe-signature": "t=123,v1=abc" } },
      );
      expect(res.status()).toBe(400);
    });
  });

  // ── API: Delete protection ──

  test.describe("API — Stripe-paid invoice protection", () => {
    test("settings endpoint masks stripe keys", async ({ request }) => {
      const res = await request.get(`${API}/settings`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      // stripeSecretKey should be null or masked, never a real value
      expect(body.stripeSecretKey === null || body.stripeSecretKey === "••••••••").toBeTruthy();
      expect(body.stripeWebhookSecret === null || body.stripeWebhookSecret === "••••••••").toBeTruthy();
    });
  });

  // ── API: Payment methods ──

  test.describe("API — Payment methods", () => {
    test("POST /payments/payment-methods rejects unknown method", async ({
      request,
    }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/payments/payment-methods`, {
        data: { paymentMethods: ["paypal"] },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(400);
    });

    test("POST /payments/payment-methods rejects empty array", async ({
      request,
    }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/payments/payment-methods`, {
        data: { paymentMethods: [] },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(400);
    });

    test("POST /payments/payment-methods saves valid methods", async ({
      request,
    }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/payments/payment-methods`, {
        data: { paymentMethods: ["card"] },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body).toHaveProperty("paymentMethods");
      expect(body.paymentMethods).toContain("card");
    });

    test("GET /payments/status response includes paymentMethods array", async ({
      request,
    }) => {
      const res = await request.get(`${API}/payments/status`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body).toHaveProperty("paymentMethods");
      expect(Array.isArray(body.paymentMethods)).toBe(true);
    });
  });

  // ── Portal: Pay Now visibility ──

  test.describe("Portal — Pay Now visibility", () => {
    test("portal does not show Pay Now when payments disabled", async ({
      page,
    }) => {
      await page.goto("/portal/projects");
      const projectLink = page
        .locator("a[href*='/portal/projects/']")
        .first();
      if (
        await projectLink.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectLink.click();
        await page.waitForTimeout(2000);
        await expect(
          page.getByRole("button", { name: /pay now/i }),
        ).not.toBeVisible();
      }
    });
  });
});
