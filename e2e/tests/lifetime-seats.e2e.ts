import { test, expect } from "@playwright/test";

// The Lifetime card hides the live seat count until the scarcity is real:
// "100 of 100 seats remaining" advertises that nobody has bought one. Below the
// threshold it shows the cap, above it the count, and at zero it sells out.
//
// The suite's API runs with its own plan table, so the plans and subscription
// responses are intercepted to drive the card directly.

const LIFETIME_MAX_SEATS = 100;

function plansResponse(lifetimeSeatsRemaining: number) {
  return {
    plans: [
      {
        id: "plan_free",
        name: "Free",
        slug: "free",
        priceMonthly: 0,
        priceLifetime: 0,
        maxProjects: 3,
        maxStorageMb: 100,
        maxMembers: 1,
        maxClients: 3,
        maxSeats: 0,
        isRecurring: true,
        features: ["3 projects"],
        description: "For trying things out",
      },
      {
        id: "plan_lifetime",
        name: "Lifetime",
        slug: "lifetime",
        priceMonthly: 0,
        priceLifetime: 29900,
        maxProjects: 0,
        maxStorageMb: 10000,
        maxMembers: 5,
        maxClients: 0,
        maxSeats: LIFETIME_MAX_SEATS,
        isRecurring: false,
        features: ["Pay once"],
        description: "One payment, forever",
      },
    ],
    lifetimeSeatsRemaining,
  };
}

async function openBillingWithSeats(
  page: import("@playwright/test").Page,
  lifetimeSeatsRemaining: number,
) {
  await page.route("**/api/billing/plans", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(plansResponse(lifetimeSeatsRemaining)),
    }),
  );
  await page.route("**/api/billing/subscription", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        subscription: {
          status: "active",
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          plan: plansResponse(lifetimeSeatsRemaining).plans[0],
        },
        usage: { projects: 0, storageMb: 0, members: 0, clients: 0 },
      }),
    }),
  );

  await page.goto("/dashboard/settings/billing");
  await expect(page.getByText("Founding member spots")).toBeVisible();
}

test.describe("lifetime seat counter", () => {
  // The plans moved out of signup and into Settings → Billing (and the in-app plan offers).

  test("shows the cap, not the count, before 50 seats have sold", async ({
    page,
  }) => {
    await openBillingWithSeats(page, 100);

    await expect(page.getByText("Limited to 100 seats")).toBeVisible();
    await expect(page.getByText(/seats remaining/i)).toHaveCount(0);
  });

  test("still shows the cap one seat below the threshold", async ({ page }) => {
    // 49 sold.
    await openBillingWithSeats(page, 51);

    await expect(page.getByText("Limited to 100 seats")).toBeVisible();
    await expect(page.getByText(/seats remaining/i)).toHaveCount(0);
  });

  test("switches to the live count once 50 seats have sold", async ({
    page,
  }) => {
    // 50 sold.
    await openBillingWithSeats(page, 50);

    await expect(page.getByText("50 of 100 seats remaining")).toBeVisible();
    await expect(page.getByText(/limited to/i)).toHaveCount(0);
  });

  test("shows sold out and disables the card at zero seats", async ({
    page,
  }) => {
    await openBillingWithSeats(page, 0);

    await expect(page.getByText("Sold out").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /sold out/i })).toBeDisabled();
  });
});
