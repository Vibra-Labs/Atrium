import { defineConfig, devices } from "@playwright/test";

// Tests the unified Docker image, which must already be running. See the
// docker-smoke job in .github/workflows/test.yml for how it is started.
export default defineConfig({
  testDir: "./docker",
  testMatch: "*.e2e.ts",
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? "http://localhost:9000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
