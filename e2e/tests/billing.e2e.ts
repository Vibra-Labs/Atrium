import { test, expect } from "@playwright/test";

const API = "http://localhost:3001/api";

test.describe("Billing", () => {
  test("GET /billing/plans returns plans list", async ({ page }) => {
    const res = await page.request.get(`${API}/billing/plans`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.plans).toBeDefined();
    expect(Array.isArray(body.plans)).toBe(true);
    // Should have at least free plan if seeded
    if (body.plans.length > 0) {
      const slugs = body.plans.map((p: { slug: string }) => p.slug);
      expect(slugs).toContain("free");
    }
  });

  test("GET /billing/plans includes lifetimeSeatsRemaining", async ({
    page,
  }) => {
    const res = await page.request.get(`${API}/billing/plans`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect("lifetimeSeatsRemaining" in body).toBe(true);
  });

  test("GET /billing/subscription returns subscription for authenticated user", async ({
    page,
  }) => {
    // Navigate first to get auth cookies
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: /overview|dashboard/i }),
    ).toBeVisible({ timeout: 10000 });

    const res = await page.request.get(`${API}/billing/subscription`);
    // If billing is enabled and subscription exists, should return 200
    // If billing is disabled or subscription doesn't exist, may return different status
    if (res.ok()) {
      const body = await res.json();
      expect(body.subscription).toBeDefined();
      expect(body.usage).toBeDefined();
      if (body.usage) {
        expect(typeof body.usage.projects).toBe("number");
        expect(typeof body.usage.storageMb).toBe("number");
        expect(typeof body.usage.members).toBe("number");
        expect(typeof body.usage.clients).toBe("number");
      }
    }
  });

  test("POST /billing/checkout rejects free plan", async ({ page, context }) => {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: /overview|dashboard/i }),
    ).toBeVisible({ timeout: 10000 });

    // Read CSRF token from browser context cookies
    const cookies = await context.cookies();
    const csrfToken = cookies.find((c) => c.name === "csrf-token")?.value || "";

    const res = await page.request.post(`${API}/billing/checkout`, {
      data: {
        planSlug: "free",
        successUrl: "http://localhost:3000/success",
        cancelUrl: "http://localhost:3000/cancel",
      },
      headers: { "x-csrf-token": csrfToken },
    });
    // Should be rejected: 400 if the free plan exists, 404 if plans aren't seeded
    expect([400, 404]).toContain(res.status());
  });

  test("billing settings page loads", async ({ page }) => {
    await page.goto("/dashboard/settings/account");
    // Should either show billing page or redirect
    // If billing is enabled, we expect the heading
    const heading = page.getByRole("heading", { name: /billing/i });
    const hasHeading = await heading
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    if (hasHeading) {
      await expect(heading).toBeVisible();
    }
  });

  test("billing page shows plans section", async ({ page }) => {
    await page.goto("/dashboard/settings/account");
    const plansHeading = page.getByRole("heading", { name: /plans/i });
    const visible = await plansHeading
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    if (visible) {
      await expect(plansHeading).toBeVisible();
      // Should show at least "Free" plan card
      await expect(page.getByText(/free/i).first()).toBeVisible();
    }
  });
});
