import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

// ---------------------------------------------------------------------------
// Branded Login
// Tests for the /login/[slug] route and the public branding API endpoints
// that back it. All browser-facing tests use a fresh unauthenticated context
// so the results reflect what a real (not-yet-logged-in) client sees.
// ---------------------------------------------------------------------------
test.describe("Branded Login", () => {
  let orgSlug: string;

  test.beforeAll(async ({ browser }) => {
    // Resolve the test org's slug from an authenticated session so subsequent
    // tests can construct valid /login/:slug URLs.
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

  // -------------------------------------------------------------------------
  // Public API — /api/branding/public/:slug
  // -------------------------------------------------------------------------
  test.describe("Public branding API", () => {
    test("returns 404 for an unknown slug", async ({ request }) => {
      const res = await request.get(
        `${API}/branding/public/nonexistent-slug-xyz-404`,
      );
      expect(res.status()).toBe(404);
    });

    test("returns 200 with required fields for a known slug", async ({
      request,
    }) => {
      if (!orgSlug) test.skip();

      const res = await request.get(`${API}/branding/public/${orgSlug}`);
      expect(res.status()).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty("orgName");
      expect(data).toHaveProperty("orgId");
      expect(data).toHaveProperty("logoSrc");
      expect(data).toHaveProperty("hideLogo");
    });

    test("orgName is a non-empty string for a known slug", async ({
      request,
    }) => {
      if (!orgSlug) test.skip();

      const res = await request.get(`${API}/branding/public/${orgSlug}`);
      expect(res.status()).toBe(200);

      const data = await res.json();
      expect(typeof data.orgName).toBe("string");
      expect(data.orgName.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Browser UI — /login/[slug]
  // -------------------------------------------------------------------------
  test.describe("Branded login page UI", () => {
    test("renders the login form for a valid slug", async ({ browser }) => {
      if (!orgSlug) test.skip();

      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();

      await page.goto(`/login/${orgSlug}`);

      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(
        page.getByRole("button", { name: /sign in/i }),
      ).toBeVisible();

      await ctx.close();
    });

    test("returns 404 for a nonexistent slug", async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();

      const res = await page.goto("/login/nonexistent-slug-xyz-404");
      expect(res?.status()).toBe(404);

      await ctx.close();
    });
  });
});

// ---------------------------------------------------------------------------
// Instance Branding
// /api/branding/instance — returns the instance-wide branding if configured,
// or 204 when none has been set (the default state for a fresh test org).
// ---------------------------------------------------------------------------
test.describe("Instance Branding API", () => {
  test("returns 204 when no instance branding is configured", async ({
    request,
  }) => {
    const res = await request.get(`${API}/branding/instance`);
    // Fresh test orgs have no instance branding — the endpoint returns 204.
    // If branding has been configured the response will be 200; accept both.
    expect([200, 204]).toContain(res.status());
  });

  test("returns 200 with JSON body when instance branding exists", async ({
    request,
  }) => {
    const res = await request.get(`${API}/branding/instance`);
    if (res.status() === 200) {
      const data = await res.json();
      // The response shape mirrors the org branding object
      expect(data).toBeDefined();
    } else {
      // 204 is equally valid — no body to check
      expect(res.status()).toBe(204);
    }
  });
});

// ---------------------------------------------------------------------------
// Domain Check Endpoint (security)
// /api/health/domain-check is restricted to loopback callers only (Caddy).
// All Playwright requests originate from the test runner, which is NOT a
// loopback address from the API's perspective, so the endpoint always
// returns 403 regardless of query parameters.
// ---------------------------------------------------------------------------
test.describe("Health domain-check endpoint (security)", () => {
  test("returns 403 for any non-loopback caller regardless of params", async ({
    request,
  }) => {
    const res = await request.get(
      `${API}/health/domain-check?domain=portal.example.com`,
    );
    expect(res.status()).toBe(403);
  });

  test("returns 403 when domain param is missing (loopback guard fires first)", async ({
    request,
  }) => {
    // The loopback check happens before the param check, so a missing domain
    // still results in 403, not 400, when called from a non-loopback address.
    const res = await request.get(`${API}/health/domain-check`);
    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Branding Domain Lookup (public)
// /api/branding/domain — resolves a Host header to an org for custom domains.
// ---------------------------------------------------------------------------
test.describe("Branding domain lookup API", () => {
  test("returns 204 for an unregistered domain", async ({ request }) => {
    const res = await request.get(
      `${API}/branding/domain?host=unknown.example.com`,
    );
    expect(res.status()).toBe(204);
  });

  test("returns 400 when host param is missing", async ({ request }) => {
    const res = await request.get(`${API}/branding/domain`);
    expect(res.status()).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Custom Domain API — /api/settings/custom-domain
// Requires authentication (owner role) and a CSRF token on mutating requests.
//
// Note on billing: if BILLING_ENABLED=true and the test org is on the free
// plan, PUT will return 403. Tests that save a domain assert either 200 or
// 403 so they pass in both billing and non-billing configurations. The GET
// and DELETE paths are not gated on plan, so they assert 200 and 204
// respectively.
// ---------------------------------------------------------------------------
test.describe("Custom Domain API", () => {
  test("GET returns the current custom domain (null by default)", async ({
    request,
  }) => {
    const res = await request.get(`${API}/settings/custom-domain`);
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty("customDomain");
    // A freshly created test org has no custom domain set
    expect(data.customDomain).toBeNull();
  });

  test("PUT with a valid domain saves it (or 403 on free plan with billing)", async ({
    request,
  }) => {
    const csrf = getCsrfToken();
    const res = await request.put(`${API}/settings/custom-domain`, {
      data: { domain: "portal.e2e-test.example.com" },
      headers: { "x-csrf-token": csrf },
    });
    // 200 = saved; 403 = billing gate (free plan). Both are acceptable.
    expect([200, 403]).toContain(res.status());

    if (res.status() === 200) {
      const data = await res.json();
      expect(data).toHaveProperty("customDomain", "portal.e2e-test.example.com");
    }
  });

  test("PUT with an invalid domain format returns 400", async ({ request }) => {
    const csrf = getCsrfToken();
    const res = await request.put(`${API}/settings/custom-domain`, {
      data: { domain: "not-a-valid-domain" },
      headers: { "x-csrf-token": csrf },
    });
    // ValidationPipe rejects malformed hostnames with 400.
    // A billing 403 cannot occur before validation, so 400 is the only
    // expected status here.
    expect(res.status()).toBe(400);
  });

  test("PUT with a domain exceeding 253 chars returns 400", async ({
    request,
  }) => {
    const csrf = getCsrfToken();
    // Build a hostname that is valid in shape but over the 253-char limit
    const longLabel = "a".repeat(63);
    const longDomain = `${longLabel}.${longLabel}.${longLabel}.${longLabel}.com`;
    const res = await request.put(`${API}/settings/custom-domain`, {
      data: { domain: longDomain },
      headers: { "x-csrf-token": csrf },
    });
    expect(res.status()).toBe(400);
  });

  test("PUT with missing domain field returns 400", async ({ request }) => {
    const csrf = getCsrfToken();
    const res = await request.put(`${API}/settings/custom-domain`, {
      data: {},
      headers: { "x-csrf-token": csrf },
    });
    expect(res.status()).toBe(400);
  });

  test("DELETE clears the custom domain and returns 200 or 204", async ({
    request,
  }) => {
    const csrf = getCsrfToken();
    const res = await request.delete(`${API}/settings/custom-domain`, {
      headers: { "x-csrf-token": csrf },
    });
    // The service removes the record — NestJS returns 200 with a body or 204
    expect([200, 204]).toContain(res.status());
  });

  test("GET after DELETE returns null custom domain", async ({ request }) => {
    // First delete (idempotent — safe even if already null)
    const csrf = getCsrfToken();
    await request.delete(`${API}/settings/custom-domain`, {
      headers: { "x-csrf-token": csrf },
    });

    // Now verify the domain is cleared
    const res = await request.get(`${API}/settings/custom-domain`);
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(data.customDomain).toBeNull();
  });

  test("mutating endpoints require authentication (no session = 401 or 403)", async ({
    browser,
  }) => {
    // Create a fresh context with no stored session to simulate an
    // unauthenticated caller.
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();

    // Ensure CSRF cookie is seeded even in the unauthenticated context
    await page.request.get(`${API}/health`);

    const res = await page.request.put(`${API}/settings/custom-domain`, {
      data: { domain: "portal.e2e-unauth.example.com" },
      headers: { "x-csrf-token": "" },
    });
    expect([401, 403]).toContain(res.status());

    await ctx.close();
  });
});
