import { chromium } from "@playwright/test";

/**
 * Global setup creates a unique test account for each test run using a
 * timestamped email (e2e-<timestamp>@test.local). These accounts are
 * intentionally not cleaned up after the run because:
 *
 *  1. Each run uses a unique email, so stale accounts don't cause conflicts.
 *  2. Cleanup would require direct database access or an admin API endpoint
 *     that doesn't exist yet.
 *
 * In CI environments the test database should be reset between runs
 * (e.g. drop/recreate the DB or use a fresh container) to prevent
 * accumulation of orphaned test data.
 */
async function globalSetup() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const email = `e2e-${Date.now()}@test.local`;
  const password = "TestPass123!";

  // Sign up via the API directly (more reliable than form interaction)
  const apiUrl = "http://localhost:3001";
  const res = await page.request.post(`${apiUrl}/api/onboarding/signup`, {
    data: { name: "E2E Test User", email, password, orgName: "E2E Test Org" },
  });

  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Signup failed (${res.status()}): ${body}`);
  }

  // The signup response sets session cookies on the API domain.
  // Navigate to a page that will establish the cookies in the browser context.
  // The API already set cookies via Set-Cookie headers on the response above.
  // Now navigate to the web app — the dashboard layout will check the session
  // via server-side fetch to the API, forwarding cookies.
  // New accounts redirect to /setup since setupCompleted=false.
  await page.goto("http://localhost:3000/dashboard", {
    waitUntil: "networkidle",
    timeout: 15000,
  });

  let url = page.url();
  if (url.includes("/login")) {
    // Cookies might not have propagated. Try logging in explicitly.
    await page.goto("http://localhost:3000/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(setup|dashboard)/, { timeout: 15000 });
    url = page.url();
  }

  // If redirected to setup wizard, complete it so existing tests work
  if (url.includes("/setup")) {
    // Get a CSRF token first (any GET request sets the csrf-token cookie)
    await page.request.get(`${apiUrl}/api/setup/status`);
    const cookies = await context.cookies();
    const csrfToken = cookies.find((c) => c.name === "csrf-token")?.value || "";

    // Try completing setup via API first (fastest path)
    const completeRes = await page.request.post(
      `${apiUrl}/api/setup/complete`,
      { headers: { "x-csrf-token": csrfToken } },
    );
    if (completeRes.ok()) {
      await page.goto("http://localhost:3000/dashboard", {
        waitUntil: "networkidle",
        timeout: 15000,
      });
    } else {
      // Fallback: step through the wizard manually
      await page.waitForSelector("text=Organization Profile", {
        timeout: 10000,
      });
      await page.getByRole("button", { name: /continue/i }).click();
      await page.waitForSelector("text=Email Configuration", {
        timeout: 10000,
      });
      await page.getByRole("button", { name: /skip & continue/i }).click();
      await page.waitForSelector("text=Create Your First Project", {
        timeout: 10000,
      });
      await page.getByRole("button", { name: /skip/i }).first().click();
      await page.waitForSelector("text=Invite a Client", { timeout: 10000 });
      await page.getByRole("button", { name: /skip/i }).first().click();
      await page.waitForSelector("text=You are all set", { timeout: 10000 });
      await page.getByRole("button", { name: /go to dashboard/i }).click();
      await page.waitForURL("**/dashboard", { timeout: 15000 });
    }
  }

  await context.storageState({ path: "e2e/.auth/user.json" });
  await browser.close();
}

export default globalSetup;
