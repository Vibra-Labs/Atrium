import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Analytics instrumentation.
 *
 * The real tracker is only loaded when ATRIUM_TRACKERS is set. These tests
 * install a stub before any page script runs and assert on what the app tried
 * to send, so they verify the call sites without needing a live Umami
 * instance or a GTM container.
 *
 * `track()` feeds Umami and GTM's `dataLayer` independently, so both paths
 * are asserted -- the dataLayer one especially, since Google Ads conversion
 * tracking hangs off it and must survive Umami being absent or blocked.
 *
 * The two are not fed the same thing. Umami is self-hosted and gets every
 * event in full; the dataLayer leaves the browser, so it gets the conversion
 * events and only their allowlisted fields. Both halves are asserted here.
 */

const API_URL: string = "http://localhost:3001";

type TrackedData = Record<string, string | number | boolean>;

interface TrackedEvent {
  name: string;
  data?: TrackedData;
}

declare global {
  interface Window {
    __trackedEvents?: TrackedEvent[];
    umami?: { track: (event: string, data?: TrackedData) => void };
    dataLayer?: Record<string, unknown>[];
    google_tag_manager?: Record<string, unknown>;
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

/**
 * Stands in for a loaded GTM container, with no Umami at all, so only the
 * dataLayer path can record anything.
 *
 * Pushes are recorded in sessionStorage because a conversion push is followed
 * immediately by a redirect, which would wipe anything held on `window`. The
 * stub also invokes `eventCallback` the way a real container does, so the
 * redirect is driven by the callback rather than by the fallback timer.
 */
async function stubGtmContainer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete window.umami;
    window.google_tag_manager = {};
    window.dataLayer = {
      push: (entry: Record<string, unknown>) => {
        const seen: Record<string, unknown>[] = JSON.parse(
          sessionStorage.getItem("__dataLayer") ?? "[]",
        );
        const { eventCallback, eventTimeout, ...rest } = entry as {
          eventCallback?: () => void;
          eventTimeout?: number;
        };
        seen.push(rest);
        sessionStorage.setItem("__dataLayer", JSON.stringify(seen));
        if (typeof eventCallback === "function") eventCallback();
        return seen.length;
      },
    } as unknown as Record<string, unknown>[];
  });
}

/**
 * Fills in the signup form on an already-loaded /signup and submits it. The
 * agency name is derived from `name`; only the email and password vary between
 * the cases below.
 */
async function submitSignup(
  page: Page,
  name: string,
  email: string,
  password: string,
): Promise<void> {
  // Billing-enabled instances show plan selection first.
  const planHeading = page.getByRole("heading", { name: /choose your plan/i });
  if (await planHeading.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /continue/i }).click();
  }

  await page.getByLabel(/your name/i).fill(name);
  await page.getByLabel(/agency/i).fill(`${name} Co`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /create account|sign up/i }).click();
}

async function trackedEvents(page: Page): Promise<TrackedEvent[]> {
  return page.evaluate(() => window.__trackedEvents ?? []);
}

async function dataLayerPushes(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    () => JSON.parse(sessionStorage.getItem("__dataLayer") ?? "[]") as Record<string, unknown>[],
  );
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

    // The password is long enough to clear the input's native minLength=8 --
    // otherwise the browser blocks submission and handleSubmit never runs --
    // but missing the uppercase/number/symbol the app requires. signup_started
    // must still fire, or attempts rejected by our own rules stay invisible.
    await submitSignup(
      page,
      "Analytics Test",
      `analytics-${Date.now()}@example.com`,
      "weakpassword",
    );

    await expect
      .poll(async () => (await trackedEvents(page)).map((e) => e.name))
      .toContain("signup_started");
  });

  // Regression guard: the GTM container used to reach these events only by
  // wrapping window.umami.track, so no Umami meant no Google Ads conversions.
  // track() must push the conversion to dataLayer on its own.
  test("a completed signup reaches dataLayer with no Umami loaded", async ({ page }) => {
    await stubGtmContainer(page);
    await page.goto("/signup");

    await submitSignup(
      page,
      "DataLayer Test",
      `datalayer-${Date.now()}@example.com`,
      "DataLayer123!",
    );

    // A free plan lands on /setup. Staying first-party matters: the pushes are
    // read back out of sessionStorage, which a Stripe Checkout origin wouldn't
    // share, so a cross-origin landing would read empty and fail for no reason.
    await page.waitForURL(/\/setup/, { timeout: 20000 });

    const pushes = await dataLayerPushes(page);
    // Exactly one: signup_started fired on the same submit and must NOT be here.
    expect(pushes).toHaveLength(1);
    expect(pushes[0].event).toBe("signup_completed");
    // The allowlist, asserted as a whole -- any extra key is a field that
    // started reaching Google without anyone deciding it should.
    expect(Object.keys(pushes[0]).sort()).toEqual(["event", "plan"]);
  });

  // Umami is self-hosted and gets everything. The dataLayer leaves the
  // browser, so a failed signup -- whose `reason` is the API's own error
  // message -- must not reach it.
  //
  // The rejection has to come from the server: the app's own password rules
  // return before the request is ever made, so signup_failed never fires on a
  // weak password. Taking an address that already exists is what reaches the
  // API and comes back with a message to leak.
  test("a failed signup reaches Umami but never dataLayer", async ({ page }) => {
    const taken: string = `privacy-${Date.now()}@example.com`;
    const created = await page.request.post(`${API_URL}/api/onboarding/signup`, {
      data: { name: "Privacy Test", email: taken, password: "Privacy123!", orgName: "Privacy Co" },
    });
    expect(created.ok(), "the first signup must succeed for the second to clash").toBe(true);

    await page.addInitScript(() => {
      window.google_tag_manager = {};
      window.dataLayer = [];
    });
    await stubTracker(page);
    await page.goto("/signup");

    await submitSignup(page, "Privacy Test", taken, "Privacy123!");

    await expect
      .poll(async () => (await trackedEvents(page)).map((e) => e.name))
      .toContain("signup_failed");

    // Umami has the message, so there is something here worth not leaking.
    const failure = (await trackedEvents(page)).find((e) => e.name === "signup_failed");
    expect(typeof failure?.data?.reason).toBe("string");
    expect((failure?.data?.reason as string).length).toBeGreaterThan(0);

    // Google gets none of it: not the reason, not the fact that it happened.
    const entries = await page.evaluate(() => window.dataLayer ?? []);
    expect(entries).toEqual([]);
  });
});

test.describe("Tracker injection", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // Regression guard: trackers are read from the server's runtime environment.
  // Static prerendering, or Next inlining a NEXT_PUBLIC_ value at build time,
  // has twice left pages untracked in production. Assert on the raw HTML
  // response, NOT the DOM -- a client-injected tag shows up in the DOM even
  // when the served HTML has no tag at all.
  const PAGES: string[] = [
    "/",
    "/changelog",
    "/login",
    "/signup",
    "/accept-invite",
    "/forgot-password",
  ];

  for (const path of PAGES) {
    test(`${path} is served with the tracker tag in its HTML`, async ({ request }) => {
      const trackers: Array<{ src: string }> = JSON.parse(
        process.env.ATRIUM_TRACKERS ?? "[]",
      );
      expect(
        trackers.length,
        "ATRIUM_TRACKERS must be set for the server under test",
      ).toBeGreaterThan(0);

      const html: string = await (await request.get(path)).text();
      for (const { src } of trackers) {
        expect(html).toContain(src);
      }
    });
  }
});
