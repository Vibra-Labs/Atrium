import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createOwner, createPortalClientProject, getCsrfTokenFromContext } from "./helpers";
import type { PortalClientProject } from "./helpers";

const WEB = "http://localhost:3000";
const API = "http://localhost:3001/api";

const SESSION_REQUEST = /\/api\/auth\/(get-session|organization\/get-active-member)(\?|$)/;

/** Browser-side requests for the session or role, made after the page has loaded. */
function watchSessionRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (req) => {
    if (SESSION_REQUEST.test(req.url())) seen.push(req.url());
  });
  return seen;
}

test.describe("Layouts seed the session on the client", () => {
  test("dashboard project and team pages don't re-fetch session or role", async ({ browser }) => {
    test.setTimeout(120000);
    const { context, page } = await createOwner(browser, "sessctx");
    try {
      const res = await page.request.post(`${API}/projects`, {
        data: { name: "Session Context E2E" },
        headers: { "x-csrf-token": await getCsrfTokenFromContext(context) },
      });
      expect(res.ok()).toBe(true);
      const project: { id: string } = await res.json();

      const projectPageRequests: string[] = watchSessionRequests(page);

      await page.goto(`${WEB}/dashboard/projects/${project.id}`, { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: "Session Context E2E" }).first()).toBeVisible({
        timeout: 15000,
      });
      // Owner-only control: proves the role reached the page.
      await expect(page.getByRole("button", { name: /delete/i }).first()).toBeVisible();
      expect(projectPageRequests, "project page").toEqual([]);

      const teamPageRequests: string[] = watchSessionRequests(page);

      await page.goto(`${WEB}/dashboard/settings/team`, { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: "Invite a Team Member" })).toBeVisible({
        timeout: 15000,
      });
      expect(teamPageRequests, "team page").toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("portal project page doesn't re-fetch the session", async ({ browser }) => {
    test.setTimeout(120000);
    const portal: PortalClientProject = await createPortalClientProject(
      browser,
      "sessctx-portal",
      "Session Context Portal E2E",
    );
    try {
      const portalPageRequests: string[] = watchSessionRequests(portal.client);
      await portal.client.goto(`${WEB}/portal/projects/${portal.projectId}`, {
        waitUntil: "networkidle",
      });
      await expect(
        portal.client.getByRole("heading", { name: "Session Context Portal E2E" }).first(),
      ).toBeVisible({ timeout: 15000 });
      expect(portalPageRequests, "portal project page").toEqual([]);
    } finally {
      await portal.close();
    }
  });
});
