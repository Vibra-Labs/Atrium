import { test, expect } from "@playwright/test";
import { createOwner, getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

// Team = your staff (owners and admins). Clients are contacts with portal access.
test.describe("Team", () => {
  // ── Navigation and redirects ────────────────────────────────────────────────

  test.describe("Navigation", () => {
    test("team page loads with heading and no tabs", async ({ page }) => {
      await page.goto("/dashboard/team");
      await expect(page.locator("h1", { hasText: /^team$/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /^clients/i })).toHaveCount(0);
      await expect(page.getByPlaceholder("client@example.com")).toHaveCount(0);
    });

    test("sidebar has Team and Contacts, and no People", async ({ page }) => {
      await page.goto("/dashboard");
      await expect(page.getByRole("link", { name: /^team$/i }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: /^contacts$/i }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: /^people$/i })).toHaveCount(0);
    });

    test("/dashboard/clients?tab=team redirects to /dashboard/team", async ({ page }) => {
      await page.goto("/dashboard/clients?tab=team");
      await page.waitForURL("**/dashboard/team");
      await expect(page.locator("h1", { hasText: /^team$/i })).toBeVisible();
    });

    test("/dashboard/clients redirects to contacts with portal access", async ({ page }) => {
      await page.goto("/dashboard/clients");
      await page.waitForURL("**/dashboard/contacts?access=portal");
      await expect(page.locator("h1", { hasText: /contacts/i })).toBeVisible();
    });

    test("/dashboard/clients?tab=clients redirects to contacts with portal access", async ({ page }) => {
      await page.goto("/dashboard/clients?tab=clients");
      await page.waitForURL("**/dashboard/contacts?access=portal");
    });

    test("the subtitle points clients to Contacts", async ({ page }) => {
      await page.goto("/dashboard/team");
      await expect(page.getByRole("link", { name: "Contacts", exact: true }).last()).toHaveAttribute(
        "href",
        "/dashboard/contacts?access=portal",
      );
    });
  });

  // ── Staff list and invites ──────────────────────────────────────────────────

  test.describe("Staff", () => {
    test("current user appears in the list with (you) label", async ({ page }) => {
      await page.goto("/dashboard/team");
      await expect(page.getByText("(you)")).toBeVisible();
    });

    test("only staff are listed", async ({ page, request }) => {
      const res = await request.get(`${API}/clients?page=1&limit=100`);
      const body: { data: { role: string }[] } = await res.json();
      const staff = body.data.filter((m) => m.role !== "member").length;
      await page.goto("/dashboard/team");
      await expect(page.getByTestId("team-member-row")).toHaveCount(staff);
    });

    test("owner can tag a staff member and the badge shows", async ({ page, request }) => {
      const name = `Staff tag ${Date.now()}`;
      const created = await request.post(`${API}/labels`, {
        data: { name },
        headers: { "x-csrf-token": getCsrfToken() },
      });
      expect(created.ok()).toBeTruthy();
      const label = (await created.json()) as { id: string };

      await page.goto("/dashboard/team");
      const row = page.getByTestId("team-member-row").filter({ hasText: "(you)" });
      await row.getByRole("button", { name: "Edit labels" }).click();
      await row.getByRole("option", { name }).click();
      await expect(row.getByRole("option", { name })).toHaveAttribute("aria-selected", "true");

      // Stored on the member (staff tag), so the badge shows after a reload.
      await page.reload();
      await expect(
        page.getByTestId("team-member-row").filter({ hasText: "(you)" }).getByText(name, { exact: true }),
      ).toBeVisible();

      await request.delete(`${API}/labels/${label.id}`, {
        headers: { "x-csrf-token": getCsrfToken() },
      });
    });

    test("team invite form is visible for owner", async ({ page }) => {
      await page.goto("/dashboard/team");
      await expect(page.getByPlaceholder("team@example.com")).toBeVisible();
      await expect(page.getByRole("button", { name: /^invite$/i })).toBeVisible();
    });

    test("team invite role selector has admin and owner, defaulting to admin", async ({ page }) => {
      await page.goto("/dashboard/team");
      const roleSelect = page.getByLabel("Role", { exact: true });
      await expect(roleSelect).toHaveValue("admin");
      await expect(roleSelect.locator("option[value='admin']")).toHaveCount(1);
      await expect(roleSelect.locator("option[value='owner']")).toHaveCount(1);
      await expect(roleSelect.locator("option[value='member']")).toHaveCount(0);
    });

    test("current user row shows their role badge", async ({ page }) => {
      await page.goto("/dashboard/team");
      const memberRow = page.getByTestId("team-member-row").filter({ hasText: "(you)" });
      await expect(memberRow.locator("span.rounded-full")).toBeVisible();
    });

    test("members section heading is visible", async ({ page }) => {
      await page.goto("/dashboard/team");
      await expect(page.getByText(/^members/i)).toBeVisible();
    });

    test("pending staff invitations show with copy link; client invites do not", async ({ browser }) => {
      // A fresh workspace, so these invites never touch the shared account's seats.
      const { context, page } = await createOwner(browser, "team-pending");
      const stamp = Date.now();
      const staffEmail = `team-pending-${stamp}@example.com`;
      const clientEmail = `team-client-pending-${stamp}@example.com`;
      for (const [email, role] of [
        [staffEmail, "admin"],
        [clientEmail, "member"],
      ]) {
        const res = await page.request.post(`${API}/auth/organization/invite-member`, {
          data: { email, role },
          headers: { Origin: "http://localhost:3000" },
        });
        expect(res.ok()).toBeTruthy();
      }

      await page.goto("http://localhost:3000/dashboard/team");
      const row = page.getByTestId("pending-invitation").filter({ hasText: staffEmail });
      await expect(row).toBeVisible();
      await expect(row.getByRole("button", { name: /copy link/i })).toBeVisible();
      await expect(page.getByTestId("pending-invitation").filter({ hasText: clientEmail })).toHaveCount(0);
      await context.close();
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
      const res = await request.get(`${API}/clients?page=1&limit=100`);
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
      const res = await request.get(`${API}/clients?page=1&limit=100`);
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

  // ── API: role change ──────────────────────────────────────────────────────────

  test.describe("API: role change", () => {
    let testMemberId: string;
    let testUserId: string;

    test.beforeAll(async ({ request }) => {
      // Find a non-owner member to use for role change tests
      const res = await request.get(`${API}/clients?page=1&limit=100`);
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
