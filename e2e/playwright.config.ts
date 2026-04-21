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
    },
    {
      command: process.env.CI
        ? "bun run --filter @atrium/web start"
        : "bun run --filter @atrium/web dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      cwd: "../",
    },
  ],
});
