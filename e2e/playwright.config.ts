import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Load the monorepo root .env so NEXT_PUBLIC_* vars are present when
// Playwright spawns `next dev` (Next.js only auto-loads envs from its own
// package directory, which is `apps/web`).
const rootEnvPath = join(__dirname, "..", ".env");
if (existsSync(rootEnvPath)) {
  for (const line of readFileSync(rootEnvPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    if (process.env[key] !== undefined) continue;
    let val = trimmed.slice(eq + 1);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

// Shared by the test runner and the web server it starts, so assertions read
// the same value the server renders. The web app reads it per request, so it
// only needs to be in the server's runtime environment, not the build's.
const TRACKERS: string =
  process.env.ATRIUM_TRACKERS ??
  '[{"src":"http://localhost:3000/__e2e-tracker.js","data-website-id":"e2e"}]';
process.env.ATRIUM_TRACKERS = TRACKERS;

/**
 * The demo workspace these tests drive. Shared with global-setup.ts, which
 * seeds it.
 *
 * It follows the configured slug when there is one, because a database holds
 * at most one demo workspace: the demo accounts' addresses are fixed, and a
 * User row is unique by email, so seeding a second workspace under a different
 * slug fails on that constraint. Pinning a separate slug here also disagreed
 * with the server — `reuseExistingServer` means a local run talks to a dev API
 * already configured for its own slug, so the suite would have been driving a
 * workspace the server knew nothing about.
 *
 * Locally that means a run reseeds the developer's demo workspace. That is
 * demo data: it is disposable by definition and resets itself twice an hour.
 * In CI nothing is configured, so this value is what Playwright starts the
 * API with.
 */
export const DEMO_SLUG: string = process.env.DEMO_ORG_SLUG ?? "demo-e2e";

// Set on the runner process too, not only in the webServer child envs: global
// setup reads it to decide whether to seed the demo workspace, and without the
// seed every demo case signs in as a user that does not exist and times out.
process.env.DEMO_MODE = "true";
process.env.DEMO_ORG_SLUG = DEMO_SLUG;

export default defineConfig({
  testDir: "./tests",
  testMatch: "*.e2e.ts",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    storageState: "e2e/.auth/user.json",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: process.env.CI
        ? "bun run apps/api/dist/main"
        : "bun run --filter @atrium/api dev",
      url: "http://localhost:3001/api/health",
      reuseExistingServer: !process.env.CI,
      cwd: "../",
      // integrations.e2e.ts points a webhook at a capture server on 127.0.0.1.
      // Blank STRIPE_CONNECT_CLIENT_ID so a developer's root .env can't flip the
      // payments tests into Connect mode.
      env: {
        INTEGRATIONS_ALLOW_PRIVATE_URLS: "true",
        STRIPE_CONNECT_CLIENT_ID: "",
        // demo.e2e.ts needs demo mode on, against the same workspace global
        // setup seeds — see DEMO_SLUG for why the two must agree.
        DEMO_MODE: "true",
        DEMO_ORG_SLUG: DEMO_SLUG,
        DEMO_OWNER_EMAIL: "owner@demo.invalid",
        DEMO_CLIENT_EMAIL: "client@demo.invalid",
      },
    },
    {
      command: process.env.CI
        ? "bun run --filter @atrium/web start"
        : "bun run --filter @atrium/web dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      cwd: "../",
      env: {
        ATRIUM_TRACKERS: TRACKERS,
        // DEMO_MODE is deliberately NOT set for the web server. Whether a page
        // shows the demo banner now comes from /api/organization/current, which
        // is organization-scoped, so every other test's workspace is unaffected
        // and only demo.e2e.ts sees the banner.
        DEMO_APP_URL: "http://localhost:3000",
      },
    },
  ],
});
