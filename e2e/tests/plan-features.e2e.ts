import { test, expect } from "@playwright/test";
import { getCsrfToken, getPlanFeatures } from "./helpers";

const API = "http://localhost:3001/api";
const UPGRADE_MESSAGE = /available on paid plans/i;

// The test workspace is on Free when billing is on (local dev) and has every
// feature when billing is off (CI, self-hosted). Each test asserts whichever
// outcome matches the workspace it is running against.
test.describe("Plan features", () => {
  test("GET /billing/features reports every Pro feature as a boolean", async ({ request }) => {
    const features = await getPlanFeatures(request);
    for (const key of ["custom_domain", "e_signatures", "online_payments", "white_label"] as const) {
      expect(typeof features[key]).toBe("boolean");
    }
  });

  test("branding shows the Powered by Atrium badge only without white-label", async ({ request }) => {
    const features = await getPlanFeatures(request);
    const res = await request.get(`${API}/branding`);
    expect(res.ok()).toBe(true);
    const branding: { poweredBy: boolean } = await res.json();
    expect(branding.poweredBy).toBe(!features.white_label);
  });

  test("portal footer matches the white-label entitlement", async ({ page, request }) => {
    const features = await getPlanFeatures(request);
    await page.goto("/portal");
    const badge = page.getByRole("link", { name: "Powered by Atrium" });
    if (features.white_label) {
      await expect(badge).toHaveCount(0);
    } else {
      await expect(badge).toBeVisible({ timeout: 10000 });
      await expect(badge).toHaveAttribute("href", /atrium\.vibralabs\.co/);
    }
  });

  test("placing signature fields is gated by e_signatures", async ({ request }) => {
    const features = await getPlanFeatures(request);
    const res = await request.put(`${API}/documents/does-not-exist/signature-fields`, {
      data: { fields: [] },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    if (features.e_signatures) {
      expect(res.status()).not.toBe(403);
    } else {
      expect(res.status()).toBe(403);
      expect((await res.json()).message).toMatch(UPGRADE_MESSAGE);
    }
  });

  test("connecting Stripe is gated by online_payments", async ({ request }) => {
    const features = await getPlanFeatures(request);
    const res = await request.post(`${API}/payments/connect/authorize`, {
      data: { returnUrl: "http://localhost:3000/dashboard/settings/payments" },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    if (features.online_payments) {
      expect(res.status()).not.toBe(403);
    } else {
      expect(res.status()).toBe(403);
      expect((await res.json()).message).toMatch(UPGRADE_MESSAGE);
    }
  });

  test("portal pay button stays hidden when online payments are locked", async ({ request }) => {
    const features = await getPlanFeatures(request);
    const res = await request.get(`${API}/payments/enabled`);
    expect(res.ok()).toBe(true);
    const body: { enabled: boolean } = await res.json();
    if (!features.online_payments) expect(body.enabled).toBe(false);
  });

  test("custom domain save is gated by custom_domain", async ({ request }) => {
    const features = await getPlanFeatures(request);
    const csrf = getCsrfToken();
    const res = await request.put(`${API}/settings/custom-domain`, {
      data: { domain: "portal.plan-features.example.com" },
      headers: { "x-csrf-token": csrf },
    });
    if (features.custom_domain) {
      expect(res.status()).toBe(200);
      await request.delete(`${API}/settings/custom-domain`, { headers: { "x-csrf-token": csrf } });
    } else {
      expect(res.status()).toBe(403);
      expect((await res.json()).message).toMatch(UPGRADE_MESSAGE);
    }
  });

  test("payments settings shows an upgrade card on Free", async ({ page, request }) => {
    const features = await getPlanFeatures(request);
    await page.goto("/dashboard/settings/payments");
    const locked = page.getByTestId("payments-locked");
    if (features.online_payments) {
      await expect(locked).toHaveCount(0);
    } else {
      await expect(locked).toBeVisible({ timeout: 10000 });
      await expect(locked.getByRole("link", { name: /upgrade to pro/i })).toHaveAttribute(
        "href",
        /reason=online-payments/,
      );
    }
  });

  test("a pending client invite counts toward the clients limit", async ({ request }) => {
    const before = (await (await request.get(`${API}/billing/subscription`)).json()).usage;
    if (!before) return; // billing off: no usage to count
    const invite = await request.post(`http://localhost:3001/api/auth/organization/invite-member`, {
      data: { email: `seat-${Date.now()}@test.local`, role: "member" },
      headers: { Origin: "http://localhost:3000" },
    });
    expect(invite.ok(), await invite.text()).toBe(true);
    const after = (await (await request.get(`${API}/billing/subscription`)).json()).usage;
    expect(after.clients).toBe(before.clients + 1);
  });
});
