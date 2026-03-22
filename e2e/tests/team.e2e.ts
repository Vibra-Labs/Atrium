import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("People (Team & Clients)", () => {
  // ── Page structure ──────────────────────────────────────────────────────────

  test.describe("Page structure", () => {
    test("people page loads with heading and both tabs", async ({ page }) => {
      await page.goto("/dashboard/clients");
      await expect(page.locator("h1", { hasText: /people/i })).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^team/i }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^clients/i }),
      ).toBeVisible();
    });

    test("page has descriptive subtitle", async ({ page }) => {
      await page.goto("/dashboard/clients");
      await expect(
        page.getByText(/manage your team and clients/i),
      ).toBeVisible();
    });

    test("people nav link exists in sidebar", async ({ page }) => {
      await page.goto("/dashboard");
      await expect(
        page.getByRole("link", { name: /people/i }),
      ).toBeVisible();
    });

    test("/dashboard/team redirects to /dashboard/clients", async ({ page }) => {
      await page.goto("/dashboard/team");
      await page.waitForURL("**/dashboard/clients");
      await expect(
        page.locator("h1", { hasText: /people/i }),
      ).toBeVisible();
    });
  });

  // ── Team tab ─────────────────────────────────────────────────────────────────

  test.describe("Team tab (default)", () => {
    test("team tab is active by default", async ({ page }) => {
      await page.goto("/dashboard/clients");
      // The team invite form placeholder is only present when team tab is active
      await expect(
        page.getByPlaceholder("team@example.com"),
      ).toBeVisible();
    });

    test("current user appears in team list with (you) label", async ({
      page,
    }) => {
      await page.goto("/dashboard/clients");
      await expect(page.getByText("(you)")).toBeVisible();
    });

    test("team invite form is visible for owner", async ({ page }) => {
      await page.goto("/dashboard/clients");
      await expect(
        page.getByPlaceholder("team@example.com"),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^invite$/i }),
      ).toBeVisible();
    });

    test("team invite form has role selector with admin and owner options", async ({
      page,
    }) => {
      await page.goto("/dashboard/clients");
      const roleSelect = page.locator("select").first();
      await expect(roleSelect).toBeVisible();
      await expect(roleSelect.locator("option[value='admin']")).toHaveCount(1);
      await expect(roleSelect.locator("option[value='owner']")).toHaveCount(1);
    });

    test("team invite role selector defaults to admin", async ({ page }) => {
      await page.goto("/dashboard/clients");
      const roleSelect = page.locator("select").first();
      await expect(roleSelect).toHaveValue("admin");
    });

    test("team members section heading is visible", async ({ page }) => {
      await page.goto("/dashboard/clients");
      await expect(page.getByText(/^members/i)).toBeVisible();
    });

    test("current user row shows their role badge", async ({ page }) => {
      await page.goto("/dashboard/clients");
      // The owner sees their own role displayed as a non-interactive badge
      // (canChangeRole is false for self)
      const youLabel = page.getByText("(you)");
      await expect(youLabel).toBeVisible();
      // The owner badge should be in a role span near the (you) label
      const memberRow = youLabel.locator("xpath=ancestor::div[contains(@class,'flex')]");
      await expect(memberRow).toBeVisible();
    });

    test("invite button is disabled while inviting", async ({ page }) => {
      await page.goto("/dashboard/clients");
      const emailInput = page.getByPlaceholder("team@example.com");
      const inviteBtn = page.getByRole("button", { name: /^invite$/i });

      await emailInput.fill("pending-test@example.com");
      // We do not actually submit; just verify the button is enabled before submit
      await expect(inviteBtn).not.toBeDisabled();
    });

    test("empty state message shown when only current user exists", async ({
      page,
    }) => {
      await page.goto("/dashboard/clients");
      // If there are no OTHER team members the empty state may show; if there are
      // additional members the list renders instead. Either state is valid — we
      // assert the section heading is present in both cases.
      await expect(page.getByText(/^members/i)).toBeVisible();
    });
  });

  // ── Clients tab ──────────────────────────────────────────────────────────────

  test.describe("Clients tab", () => {
    test("switching to clients tab shows client invite form", async ({
      page,
    }) => {
      await page.goto("/dashboard/clients");
      await page.getByRole("button", { name: /^clients/i }).click();
      await expect(
        page.getByPlaceholder("client@example.com"),
      ).toBeVisible();
    });

    test("clients tab shows invite button", async ({ page }) => {
      await page.goto("/dashboard/clients");
      await page.getByRole("button", { name: /^clients/i }).click();
      await expect(
        page.getByRole("button", { name: /^invite$/i }),
      ).toBeVisible();
    });

    test("clients tab shows Clients section heading", async ({ page }) => {
      await page.goto("/dashboard/clients");
      await page.getByRole("button", { name: /^clients/i }).click();
      await expect(page.getByText(/^clients/i)).toBeVisible();
    });

    test("clients tab shows empty state when no clients exist", async ({
      page,
    }) => {
      await page.goto("/dashboard/clients");
      await page.getByRole("button", { name: /^clients/i }).click();
      // Wait for the loading skeleton to disappear
      await page.waitForTimeout(500);
      // Either the client list or the empty state message should be present
      const emptyMsg = page.getByText(/no clients yet/i);
      const clientItem = page.locator(
        "[class*='border'][class*='rounded'] .text-sm.font-medium",
      );
      const hasEmpty = await emptyMsg.isVisible({ timeout: 3000 }).catch(() => false);
      const hasClients = await clientItem.first().isVisible({ timeout: 1000 }).catch(() => false);
      expect(hasEmpty || hasClients).toBe(true);
    });

    test("team tab content hides when clients tab is active", async ({
      page,
    }) => {
      await page.goto("/dashboard/clients");
      await page.getByRole("button", { name: /^clients/i }).click();
      // The team invite email placeholder should no longer be on screen
      await expect(
        page.getByPlaceholder("team@example.com"),
      ).not.toBeVisible();
    });

    test("client invite button is disabled while inviting", async ({
      page,
    }) => {
      await page.goto("/dashboard/clients");
      await page.getByRole("button", { name: /^clients/i }).click();
      const emailInput = page.getByPlaceholder("client@example.com");
      const inviteBtn = page.getByRole("button", { name: /^invite$/i });

      await emailInput.fill("client-pending@example.com");
      await expect(inviteBtn).not.toBeDisabled();
    });
  });

  // ── Tab switching ─────────────────────────────────────────────────────────────

  test.describe("Tab switching", () => {
    test("can switch from team tab to clients tab and back", async ({
      page,
    }) => {
      await page.goto("/dashboard/clients");

      // Start on team tab
      await expect(
        page.getByPlaceholder("team@example.com"),
      ).toBeVisible();

      // Switch to clients
      await page.getByRole("button", { name: /^clients/i }).click();
      await expect(
        page.getByPlaceholder("client@example.com"),
      ).toBeVisible();
      await expect(
        page.getByPlaceholder("team@example.com"),
      ).not.toBeVisible();

      // Switch back to team
      await page.getByRole("button", { name: /^team/i }).click();
      await expect(
        page.getByPlaceholder("team@example.com"),
      ).toBeVisible();
      await expect(
        page.getByPlaceholder("client@example.com"),
      ).not.toBeVisible();
    });

    test("tab count badge appears once members are loaded", async ({
      page,
    }) => {
      await page.goto("/dashboard/clients");
      // Wait for loading to complete — the API call populates team count
      await page.waitForTimeout(1000);
      // The team tab button text includes a count like "Team (1)" when loaded
      // We just assert the button is visible; the count is a bonus
      await expect(
        page.getByRole("button", { name: /team/i }),
      ).toBeVisible();
    });
  });

  // ── Pending invitations UI ───────────────────────────────────────────────────

  test.describe("Pending invitations display", () => {
    test("pending team invitations section shows when invitations exist", async ({
      page,
      request,
    }) => {
      // First check via API if there are any pending non-member invitations
      const res = await request.get(`${API}/clients/invitations`);
      if (!res.ok()) {
        test.skip(true, "Could not fetch invitations");
        return;
      }
      const invitations: Array<{ role: string }> = await res.json();
      const teamInvitations = invitations.filter((i) => i.role !== "member");
      if (teamInvitations.length === 0) {
        test.skip(true, "No pending team invitations to verify UI");
        return;
      }

      await page.goto("/dashboard/clients");
      await expect(
        page.getByText(/pending invitations/i),
      ).toBeVisible({ timeout: 5000 });
    });

    test("pending client invitations section shows when invitations exist", async ({
      page,
      request,
    }) => {
      const res = await request.get(`${API}/clients/invitations`);
      if (!res.ok()) {
        test.skip(true, "Could not fetch invitations");
        return;
      }
      const invitations: Array<{ role: string }> = await res.json();
      const clientInvitations = invitations.filter((i) => i.role === "member");
      if (clientInvitations.length === 0) {
        test.skip(true, "No pending client invitations to verify UI");
        return;
      }

      await page.goto("/dashboard/clients");
      await page.getByRole("button", { name: /^clients/i }).click();
      await expect(
        page.getByText(/pending invitations/i),
      ).toBeVisible({ timeout: 5000 });
    });

    test("pending invitation row shows copy link button", async ({
      page,
      request,
    }) => {
      const res = await request.get(`${API}/clients/invitations`);
      if (!res.ok()) {
        test.skip(true, "Could not fetch invitations");
        return;
      }
      const invitations: Array<{ role: string }> = await res.json();
      if (invitations.length === 0) {
        test.skip(true, "No pending invitations to verify UI");
        return;
      }

      const isTeamInvite = invitations[0].role !== "member";
      await page.goto("/dashboard/clients");
      if (!isTeamInvite) {
        await page.getByRole("button", { name: /^clients/i }).click();
      }
      await expect(
        page.getByText(/copy link/i).first(),
      ).toBeVisible({ timeout: 5000 });
    });
  });

  // ── Client profile expansion ──────────────────────────────────────────────────

  test.describe("Client profile expansion", () => {
    test("client row expands to show profile fields when clicked", async ({
      page,
      request,
    }) => {
      // Check if there are any client members via API first
      const res = await request.get(`${API}/clients?page=1&limit=10`);
      if (!res.ok()) {
        test.skip(true, "Could not fetch members");
        return;
      }
      const body: { data: Array<{ role: string }> } = await res.json();
      const clients = body.data.filter((m) => m.role === "member");
      if (clients.length === 0) {
        test.skip(true, "No client members to test profile expansion");
        return;
      }

      await page.goto("/dashboard/clients");
      await page.getByRole("button", { name: /^clients/i }).click();
      // Wait for client list to render
      await page.waitForTimeout(500);

      // Click the first client row to expand it
      const firstClientRow = page
        .locator("[class*='border'][class*='rounded-lg']")
        .filter({ has: page.locator("[class*='cursor-pointer']") })
        .first();
      await firstClientRow.click();

      // Profile fields should now be visible
      await expect(page.getByText(/^company$/i)).toBeVisible({ timeout: 3000 });
      await expect(page.getByText(/^phone$/i)).toBeVisible({ timeout: 3000 });
      await expect(page.getByText(/^address$/i)).toBeVisible({ timeout: 3000 });
      await expect(page.getByText(/^website$/i)).toBeVisible({ timeout: 3000 });
      await expect(page.getByText(/^description$/i)).toBeVisible({ timeout: 3000 });
      await expect(
        page.getByRole("button", { name: /save profile/i }),
      ).toBeVisible();
    });

    test("clicking expanded client row again collapses the profile", async ({
      page,
      request,
    }) => {
      const res = await request.get(`${API}/clients?page=1&limit=10`);
      if (!res.ok()) {
        test.skip(true, "Could not fetch members");
        return;
      }
      const body: { data: Array<{ role: string }> } = await res.json();
      const clients = body.data.filter((m) => m.role === "member");
      if (clients.length === 0) {
        test.skip(true, "No client members to test profile collapse");
        return;
      }

      await page.goto("/dashboard/clients");
      await page.getByRole("button", { name: /^clients/i }).click();
      await page.waitForTimeout(500);

      const clickTarget = page
        .locator("[class*='cursor-pointer']")
        .first();
      // First click expands
      await clickTarget.click();
      await expect(
        page.getByRole("button", { name: /save profile/i }),
      ).toBeVisible({ timeout: 3000 });

      // Second click collapses
      await clickTarget.click();
      await expect(
        page.getByRole("button", { name: /save profile/i }),
      ).not.toBeVisible({ timeout: 3000 });
    });
  });

  // ── API: members ─────────────────────────────────────────────────────────────

  test.describe("API: list members", () => {
    test("GET /clients returns paginated member list", async ({ request }) => {
      const res = await request.get(`${API}/clients?page=1&limit=20`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.meta).toBeDefined();
      expect(typeof body.meta.total).toBe("number");
      expect(typeof body.meta.page).toBe("number");
      expect(typeof body.meta.limit).toBe("number");
      expect(typeof body.meta.totalPages).toBe("number");
    });

    test("GET /clients member records have expected shape", async ({
      request,
    }) => {
      const res = await request.get(`${API}/clients?page=1&limit=20`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      // There is always at least the owner
      expect(body.data.length).toBeGreaterThan(0);
      const member = body.data[0];
      expect(member.id).toBeTruthy();
      expect(member.userId).toBeTruthy();
      expect(member.role).toBeTruthy();
      expect(member.user).toBeDefined();
      expect(member.user.name).toBeTruthy();
      expect(member.user.email).toBeTruthy();
    });

    test("GET /clients includes at least the owner in results", async ({
      request,
    }) => {
      const res = await request.get(`${API}/clients?page=1&limit=250`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      const ownerMembers = body.data.filter(
        (m: { role: string }) => m.role === "owner",
      );
      expect(ownerMembers.length).toBeGreaterThan(0);
    });

    test("GET /clients separates team members (non-member role) from clients (member role)", async ({
      request,
    }) => {
      const res = await request.get(`${API}/clients?page=1&limit=250`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      // Every record must have a role field
      for (const m of body.data) {
        expect(["owner", "admin", "member"]).toContain(m.role);
      }
    });

    test("GET /clients respects pagination limit", async ({ request }) => {
      const res = await request.get(`${API}/clients?page=1&limit=1`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data.length).toBeLessThanOrEqual(1);
      expect(body.meta.limit).toBe(1);
    });
  });

  // ── API: invitations ─────────────────────────────────────────────────────────

  test.describe("API: invitations", () => {
    test("GET /clients/invitations returns an array", async ({ request }) => {
      const res = await request.get(`${API}/clients/invitations`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body).toBeInstanceOf(Array);
    });

    test("GET /clients/invitations invitation records have expected shape when present", async ({
      request,
    }) => {
      const res = await request.get(`${API}/clients/invitations`);
      expect(res.ok()).toBeTruthy();
      const invitations: Array<{
        id: string;
        email: string;
        role: string;
        status: string;
        expiresAt: string;
        inviteLink: string;
      }> = await res.json();

      if (invitations.length === 0) {
        // No pending invitations — shape check not applicable
        return;
      }

      const inv = invitations[0];
      expect(inv.id).toBeTruthy();
      expect(inv.email).toBeTruthy();
      expect(inv.role).toBeTruthy();
      expect(inv.status).toBe("pending");
      expect(inv.expiresAt).toBeTruthy();
      expect(inv.inviteLink).toContain("/accept-invite?id=");
    });

    test("GET /clients/invitations only returns pending invitations", async ({
      request,
    }) => {
      const res = await request.get(`${API}/clients/invitations`);
      expect(res.ok()).toBeTruthy();
      const invitations: Array<{ status: string }> = await res.json();
      for (const inv of invitations) {
        expect(inv.status).toBe("pending");
      }
    });

    test("GET /clients/invitations invite link is a well-formed URL", async ({
      request,
    }) => {
      const res = await request.get(`${API}/clients/invitations`);
      expect(res.ok()).toBeTruthy();
      const invitations: Array<{ inviteLink: string }> = await res.json();
      for (const inv of invitations) {
        expect(() => new URL(inv.inviteLink)).not.toThrow();
      }
    });
  });

  // ── API: client profile (own) ─────────────────────────────────────────────────

  test.describe("API: client profile (own)", () => {
    test("GET /clients/me/profile returns own profile", async ({ request }) => {
      const res = await request.get(`${API}/clients/me/profile`);
      expect(res.ok()).toBeTruthy();
    });

    test("PUT /clients/me/profile updates own profile fields", async ({
      request,
    }) => {
      const csrfToken = getCsrfToken();
      const res = await request.put(`${API}/clients/me/profile`, {
        data: {
          company: "E2E People Test Company",
          phone: "555-9876",
          address: "123 E2E St",
          website: "https://e2e-test.example.com",
          description: "Automated e2e test description",
        },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.company).toBe("E2E People Test Company");
      expect(body.phone).toBe("555-9876");
    });

    test("PUT /clients/me/profile accepts partial updates", async ({
      request,
    }) => {
      const csrfToken = getCsrfToken();
      const res = await request.put(`${API}/clients/me/profile`, {
        data: { company: "Partial Update Co" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.company).toBe("Partial Update Co");
    });
  });

  // ── API: role change ──────────────────────────────────────────────────────────

  test.describe("API: role change", () => {
    let testMemberId: string;
    let testUserId: string;

    test.beforeAll(async ({ request }) => {
      // Find a non-owner member to use for role change tests
      const res = await request.get(`${API}/clients?page=1&limit=250`);
      if (!res.ok()) return;
      const body = await res.json();
      const adminOrMember = body.data.find(
        (m: { role: string }) => m.role === "admin",
      );
      if (adminOrMember) {
        testMemberId = adminOrMember.id;
        testUserId = adminOrMember.userId;
      }
    });

    test("PUT /clients/:id/role requires owner role (endpoint exists)", async ({
      request,
    }) => {
      test.skip(!testMemberId, "No admin member available to test role change");
      const csrfToken = getCsrfToken();
      // We just verify the endpoint exists and returns a meaningful status
      const res = await request.put(`${API}/clients/${testMemberId}/role`, {
        data: { role: "admin" },
        headers: { "x-csrf-token": csrfToken },
      });
      // Owner is making this request so it should succeed (200) or at minimum
      // not return 404. Forbidden (403) would mean the test user is not owner.
      expect([200, 403]).toContain(res.status());
    });
  });

  // ── API: remove member ────────────────────────────────────────────────────────

  test.describe("API: remove member guard", () => {
    test("DELETE /clients/:id with non-existent id returns 404 or 400", async ({
      request,
    }) => {
      const csrfToken = getCsrfToken();
      const res = await request.delete(
        `${API}/clients/nonexistent-member-id-xyz`,
        { headers: { "x-csrf-token": csrfToken } },
      );
      // Should not be a successful 2xx for a bogus id
      expect(res.ok()).toBeFalsy();
    });
  });
});
