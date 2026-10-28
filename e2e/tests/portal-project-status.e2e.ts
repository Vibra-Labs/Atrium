import { test, expect } from "@playwright/test";
import { createPortalClientProject } from "./helpers";
import type { PortalClientProject } from "./helpers";

const API = "http://localhost:3001/api";
const WEB = "http://localhost:3000";

test.describe("Portal project status", () => {
  test("shows a single pill with the project's current status", async ({ browser }) => {
    test.setTimeout(120000);
    const portal: PortalClientProject = await createPortalClientProject(browser, "status", "Portal Status E2E");
    try {
      const statusesRes = await portal.owner.request.get(`${API}/projects/statuses`);
      expect(statusesRes.ok()).toBeTruthy();
      const statuses: { name: string }[] = await statusesRes.json();
      const names: string[] = statuses.map((s) => s.name);
      expect(names.length).toBeGreaterThan(1);

      const client = portal.client;
      await client.goto(`${WEB}/portal/projects`);
      await client.getByRole("link", { name: /Portal Status E2E/ }).click({ timeout: 15000 });
      await expect(client).toHaveURL(new RegExp(`/portal/projects/${portal.projectId}$`));

      // The header shows one pill with the current status.
      const pill = client.getByTestId("project-status-pill");
      await expect(pill).toHaveCount(1, { timeout: 15000 });
      const pillText: string = (await pill.innerText()).trim();
      expect(names).toContain(pillText);

      // "All projects" is a real link, so it works without browser history (preview tabs, email links).
      await expect(client.getByRole("link", { name: "All projects" })).toHaveAttribute("href", "/portal/projects");
    } finally {
      await portal.close();
    }
  });
});
