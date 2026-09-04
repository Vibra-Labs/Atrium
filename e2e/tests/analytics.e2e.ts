import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Analytics instrumentation.
 *
 * The real tracker is only loaded when NEXT_PUBLIC_TRACKERS is set, and
 * `track()` no-ops when `window.umami` is missing. These tests install a stub
 * before any page script runs and assert on what the app tried to send, so
 * they verify the call sites without needing a live Umami instance.
 */

type TrackedData = Record<string, string | number | boolean>;

interface TrackedEvent {
  name: string;
  data?: TrackedData;
}

declare global {
  interface Window {
    __trackedEvents?: TrackedEvent[];
    umami?: { track: (event: string, data?: TrackedData) => void };
  }
}

async function stubTracker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__trackedEvents = [];
    window.umami = {
      track: (name: string, data?: TrackedData) => {
        window.__trackedEvents?.push({ name, data });
      },
    };
  });
}

async function trackedEvents(page: Page): Promise<TrackedEvent[]> {
  return page.evaluate(() => window.__trackedEvents ?? []);
}

test.describe("Analytics instrumentation", () => {
  // These run signed out — the stored auth state would redirect away from
  // /login and /signup before anything is tracked.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("failed login reports a reason", async ({ page }) => {
    await stubTracker(page);
    await page.goto("/login");

    await page.getByLabel(/email/i).fill("nobody@example.com");
    await page.getByLabel(/password/i).fill("WrongPassword1!");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect
      .poll(async () => (await trackedEvents(page)).map((e) => e.name))
      .toContain("login_failed");

    const failure = (await trackedEvents(page)).find(
      (e) => e.name === "login_failed",
    );
    expect(typeof failure?.data?.reason).toBe("string");
    expect(failure?.data?.branded).toBe(false);
  });

  test("submitting signup reports an attempt before validation", async ({
    page,
  }) => {
    await stubTracker(page);
    await page.goto("/signup");

    // Billing-enabled instances show plan selection first.
    const planHeading = page.getByRole("heading", { name: /choose your plan/i });
    if (await planHeading.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: /continue/i }).click();
    }

    await page.getByLabel(/your name/i).fill("Analytics Test");
    await page.getByLabel(/agency/i).fill("Analytics Test Co");
    await page.getByLabel(/email/i).fill(`analytics-${Date.now()}@example.com`);
    // Long enough to clear the input's native minLength=8 -- otherwise the
    // browser blocks submission and handleSubmit never runs -- but missing the
    // uppercase/number/symbol the app requires. signup_started must still fire,
    // or attempts rejected by our own rules stay invisible.
    await page.getByLabel(/password/i).fill("weakpassword");
    await page.getByRole("button", { name: /create account|sign up/i }).click();

    await expect
      .poll(async () => (await trackedEvents(page)).map((e) => e.name))
      .toContain("signup_started");
  });
});

test.describe("Tracker injection", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // Regression guard: these routes were statically prerendered, which resolved
  // NEXT_PUBLIC_TRACKERS at build time and left them permanently untracked in
  // any image built without it. Assert on the raw HTML response, NOT the DOM --
  // a client-injected tag shows up in the DOM even when the served HTML has no
  // tag at all, which is what made the first version of this test useless.
  const PRERENDERED: string[] = ["/signup", "/accept-invite", "/forgot-password"];

  for (const path of PRERENDERED) {
    test(`${path} is served with the tracker tag in its HTML`, async ({ request }) => {
      const trackers: Array<{ src: string }> = JSON.parse(
        process.env.NEXT_PUBLIC_TRACKERS ?? "[]",
      );
      expect(
        trackers.length,
        "NEXT_PUBLIC_TRACKERS must be set for the server under test",
      ).toBeGreaterThan(0);

      const html: string = await (await request.get(path)).text();
      for (const { src } of trackers) {
        expect(html).toContain(src);
      }
    });
  }
});
