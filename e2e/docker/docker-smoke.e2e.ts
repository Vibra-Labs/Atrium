import { test, expect, type Page } from "@playwright/test";

/**
 * Runs against the published Docker image with its port remapped
 * (9000:8080, WEB_URL=http://localhost:9000), the setup that broke for users.
 * Inside the container nothing listens on 9000, so any server-side call that
 * goes to the public URL instead of the API directly fails here.
 *
 * Everything goes through the app's own origin, as it does in production:
 * the image is built with an empty NEXT_PUBLIC_API_URL.
 */

async function csrfToken(page: Page): Promise<string> {
  // Any GET sets the csrf-token cookie that mutating requests have to echo.
  await page.request.get("/api/setup/status");
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name === "csrf-token")?.value ?? "";
}

async function completeSetupIfNeeded(page: Page): Promise<void> {
  if (!page.url().includes("/setup")) return;
  const res = await page.request.post("/api/setup/complete", {
    headers: { "x-csrf-token": await csrfToken(page) },
  });
  expect(res.ok(), `setup/complete returned ${res.status()}`).toBe(true);
  await page.goto("/dashboard", { waitUntil: "networkidle" });
}

test("signs up, creates an org and stays signed in on a remapped port", async ({ page }) => {
  const email = `smoke-${Date.now()}@test.local`;
  const signup = await page.request.post("/api/onboarding/signup", {
    data: { name: "Smoke Test", email, password: "TestPass123!", orgName: "Smoke Org" },
  });
  expect(signup.ok(), `signup returned ${signup.status()}: ${await signup.text()}`).toBe(true);

  // Server-rendered: the layout loads the session from the API. A failed
  // lookup redirects to /login.
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  expect(page.url()).not.toContain("/login");
  await completeSetupIfNeeded(page);
  expect(page.url()).toMatch(/\/dashboard$/);

  // The internal API address must never reach the browser (logo, favicon).
  expect(await page.content()).not.toContain("127.0.0.1");

  // Issue #82: creating an org from the browser.
  await page.goto("/dashboard/settings/organizations");
  await page.getByPlaceholder("Company name").fill("Second Org");
  await page.getByRole("button", { name: /^create$/i }).click();
  // A new org starts in its setup wizard. Not networkidle: the wizard keeps a
  // request open in the production build.
  await page.waitForURL(/\/(dashboard|setup)$/, { timeout: 20000 });
  await completeSetupIfNeeded(page);
  expect(page.url()).toMatch(/\/dashboard$/);

  const orgs = await page.request.get("/api/auth/organization/list").then((r) => r.json());
  expect(orgs.map((o: { name: string }) => o.name).sort()).toEqual(["Second Org", "Smoke Org"]);
});
