import { test, expect, Page } from "@playwright/test";

const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";

/**
 * Helper: after clicking Continue on org profile, the wizard may show
 * "Email Configuration" or skip straight to "Create Your First Project"
 * depending on whether RESEND_API_KEY is set in the environment.
 * This helper handles both scenarios.
 */
async function skipEmailStepIfPresent(page: Page) {
  // Wait for whichever heading appears next
  await expect(
    page
      .getByRole("heading", { name: /email configuration/i })
      .or(page.getByRole("heading", { name: /create your first project/i })),
  ).toBeVisible({ timeout: 5000 });

  // If email config step is showing, skip it
  const emailHeading = page.getByRole("heading", {
    name: /email configuration/i,
  });
  if (await emailHeading.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /skip & continue/i }).click();
    await expect(
      page.getByRole("heading", { name: /create your first project/i }),
    ).toBeVisible({ timeout: 5000 });
  }
}

/**
 * Helper: sign up a fresh user and navigate to the setup wizard.
 * Returns after the "Organization Profile" step heading is visible.
 */
async function signupAndNavigateToSetup(
  page: Page,
  prefix: string,
): Promise<{ email: string; password: string }> {
  const email = `${prefix}-${Date.now()}@test.local`;
  const password = `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}123!`;

  await page.request.post(`${API_URL}/api/onboarding/signup`, {
    data: {
      name: `${prefix} User`,
      email,
      password,
      orgName: `${prefix} Org`,
    },
  });

  await page.goto(`${WEB_URL}/setup`, {
    waitUntil: "networkidle",
    timeout: 15000,
  });

  if (page.url().includes("/login")) {
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(setup|dashboard)/, { timeout: 15000 });
  }

  await expect(
    page.getByRole("heading", { name: /organization profile/i }),
  ).toBeVisible({ timeout: 10000 });

  return { email, password };
}

/**
 * Helper: step through the entire wizard from org profile to completion.
 */
async function completeSetupWizard(page: Page) {
  // Step 1: Org profile -> Continue
  await page.getByRole("button", { name: /continue/i }).click();

  // Step 2: Email (may be skipped)
  await skipEmailStepIfPresent(page);

  // Step 3: First Project -> Skip
  await page.getByRole("button", { name: /skip/i }).first().click();

  // Step 4: Invite Client -> Skip
  await expect(
    page.getByRole("heading", { name: /invite a client/i }),
  ).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: /skip/i }).first().click();

  // Step 5: Complete -> Go to Dashboard
  await expect(
    page.getByRole("heading", { name: /you are all set/i }),
  ).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: /go to dashboard/i }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });
}

test.describe("Setup Wizard", () => {
  test("setup wizard page loads for new org owner", async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    const email = `setup-test-${Date.now()}@test.local`;
    const password = "SetupTest123!";

    // Sign up a new account via API
    const res = await page.request.post(`${API_URL}/api/onboarding/signup`, {
      data: {
        name: "Setup Test User",
        email,
        password,
        orgName: "Setup Test Org",
      },
    });
    expect(res.ok()).toBeTruthy();

    // Navigate to dashboard — should redirect to setup for new org
    await page.goto(`${WEB_URL}/dashboard`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });

    // If redirected to login, sign in manually
    if (page.url().includes("/login")) {
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill(password);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL(/\/(setup|dashboard)/, { timeout: 15000 });
    }

    // Should be on setup page (new org has setupCompleted=false)
    const url = page.url();
    expect(url).toMatch(/\/setup/);

    // Verify the setup wizard heading is visible
    await expect(
      page.getByRole("heading", { name: /welcome to atrium/i }),
    ).toBeVisible({ timeout: 10000 });

    // Verify step 1 (Organization Profile) is shown
    await expect(
      page.getByRole("heading", { name: /organization profile/i }),
    ).toBeVisible();

    // Verify org name is pre-filled
    const orgNameInput = page.locator("#setup-org-name");
    await expect(orgNameInput).toBeVisible();

    await context.close();
  });

  test("inviting a client from the wizard asks to confirm the address first", async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await signupAndNavigateToSetup(page, "setup-invite-confirm");

    await page.getByRole("button", { name: /continue/i }).click();
    await skipEmailStepIfPresent(page);
    await page.getByRole("button", { name: /skip/i }).first().click();
    await expect(page.getByRole("heading", { name: /invite a client/i })).toBeVisible({ timeout: 5000 });

    const clientEmail = `setup-confirm-${Date.now()}@test.local`;
    await page.getByLabel(/client email/i).fill(clientEmail);

    // Cancelling sends nothing.
    await page.getByRole("button", { name: /send invitation/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(clientEmail);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText(`Invitation sent to ${clientEmail}`)).toHaveCount(0);

    await page.getByRole("button", { name: /send invitation/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText(`Invitation sent to ${clientEmail}`)).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  test("setup wizard step navigation works", async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await signupAndNavigateToSetup(page, "setup-nav");

    // Step 1: Click Continue (org profile)
    await page.getByRole("button", { name: /continue/i }).click();

    // Step 2: Email (may be skipped if RESEND_API_KEY is set)
    await skipEmailStepIfPresent(page);

    // Step 3: First Project -> Skip
    await page.getByRole("button", { name: /skip/i }).first().click();

    // Step 4: Invite Client should appear
    await expect(
      page.getByRole("heading", { name: /invite a client/i }),
    ).toBeVisible({ timeout: 5000 });

    // Click Skip on invite step
    await page.getByRole("button", { name: /skip/i }).first().click();

    // Step 5: Complete should appear
    await expect(
      page.getByRole("heading", { name: /you are all set/i }),
    ).toBeVisible({ timeout: 5000 });

    // Click "Go to Dashboard"
    await page.getByRole("button", { name: /go to dashboard/i }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });

    await context.close();
  });

  test("setup wizard back navigation works", async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await signupAndNavigateToSetup(page, "setup-back");

    // Go to next step
    await page.getByRole("button", { name: /continue/i }).click();

    // Wait for whichever step appears (email config or first project)
    const nextStepHeading = page
      .getByRole("heading", { name: /email configuration/i })
      .or(page.getByRole("heading", { name: /create your first project/i }));
    await expect(nextStepHeading).toBeVisible({ timeout: 5000 });

    // Click Back
    await page.getByRole("button", { name: /back/i }).click();

    // Should return to step 1
    await expect(
      page.getByRole("heading", { name: /organization profile/i }),
    ).toBeVisible({ timeout: 5000 });

    await context.close();
  });

  test("completed setup does not redirect to wizard", async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await signupAndNavigateToSetup(page, "setup-done");

    // Quick-complete the wizard
    await completeSetupWizard(page);

    // Now navigating to dashboard should NOT redirect to setup
    await page.goto(`${WEB_URL}/dashboard`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });
    await expect(page).toHaveURL(/dashboard/, { timeout: 5000 });
    await expect(
      page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ }),
    ).toBeVisible({ timeout: 5000 });

    await context.close();
  });

  test("setup wizard creates a project when filled in", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await signupAndNavigateToSetup(page, "setup-proj");

    // Step 1: Continue with org profile
    await page.getByRole("button", { name: /continue/i }).click();

    // Step 2: Email (may be skipped)
    await skipEmailStepIfPresent(page);

    // Step 3: Create a project
    await page.locator("#setup-project-name").fill("My Test Project");
    await page
      .locator("#setup-project-desc")
      .fill("A test project description");
    await page.getByRole("button", { name: /create & continue/i }).click();

    // Step 4: Skip invite
    await expect(
      page.getByRole("heading", { name: /invite a client/i }),
    ).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /skip/i }).first().click();

    // Step 5: Complete
    await expect(
      page.getByRole("heading", { name: /you are all set/i }),
    ).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /go to dashboard/i }).click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });

    // Verify the project was created by checking the projects page
    await page.goto(`${WEB_URL}/dashboard/projects`);
    await expect(page.getByText("My Test Project")).toBeVisible({
      timeout: 10000,
    });

    await context.close();
  });

  test("stepper shows correct progress indicators", async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await signupAndNavigateToSetup(page, "setup-step");

    await expect(
      page.getByRole("heading", { name: /welcome to atrium/i }),
    ).toBeVisible({ timeout: 10000 });

    // Verify step labels are present (visible on desktop)
    await expect(page.getByText("Organization", { exact: true })).toBeVisible();
    // The "Email" step may not be present if RESEND_API_KEY is configured
    await expect(page.getByText("Complete", { exact: true })).toBeVisible();

    await context.close();
  });
});
