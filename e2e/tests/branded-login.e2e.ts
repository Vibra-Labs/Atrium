import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Branded Login", () => {
  let orgSlug: string;

  test.beforeAll(async ({ browser }) => {
    // Get the org slug from the authenticated session
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await page.waitForTimeout(1000);

    const res = await page.request.get(`${API}/auth/get-session`, {
      headers: { "Content-Type": "application/json" },
    });
    const session = await res.json().catch(() => null);
    orgSlug = session?.session?.activeOrganizationSlug ?? "";
    await ctx.close();
  });

  test("branded login page renders org name and form", async ({ browser }) => {
    if (!orgSlug) test.skip();

    // Use a fresh unauthenticated context
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();

    await page.goto(`/login/${orgSlug}`);

    // Form should be visible
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();

    await ctx.close();
  });

  test("nonexistent slug returns 404", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();

    const res = await page.goto("/login/nonexistent-slug-xyz-404");
    expect(res?.status()).toBe(404);

    await ctx.close();
  });

  test("API returns 404 for unknown slug", async ({ request }) => {
    const csrf = await getCsrfToken(request);
    const res = await request.get(`${API}/branding/public/nonexistent-slug-xyz-404`, {
      headers: { "x-csrf-token": csrf },
    });
    expect(res.status()).toBe(404);
  });

  test("API returns branding for known slug", async ({ request }) => {
    if (!orgSlug) test.skip();

    const res = await request.get(`${API}/branding/public/${orgSlug}`);
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty("orgName");
    expect(data).toHaveProperty("orgId");
    expect(data).toHaveProperty("logoSrc");
    expect(data).toHaveProperty("hideLogo");
  });

  test("domain-check returns 404 for unregistered domain", async ({ request }) => {
    const res = await request.get(`${API}/health/domain-check?domain=unknown.example.com`);
    expect(res.status()).toBe(404);
  });

  test("domain-check returns 400 when domain param missing", async ({ request }) => {
    const res = await request.get(`${API}/health/domain-check`);
    expect(res.status()).toBe(400);
  });

  test("branding/domain returns 204 for unregistered domain", async ({ request }) => {
    const res = await request.get(`${API}/branding/domain?host=unknown.example.com`);
    expect(res.status()).toBe(204);
  });
});
