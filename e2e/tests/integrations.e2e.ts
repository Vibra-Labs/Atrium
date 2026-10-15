import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getCsrfToken, getOrCreateProject, getPlanFeatures } from "./helpers";

const API = "http://localhost:3001/api";

interface Captured {
  headers: IncomingHttpHeaders;
  body: string;
  json: { event: string; project: { id: string } | null; title: string; detail: string | null };
}

/** A local receiver standing in for Zapier/n8n. Records every POST it gets. */
function startCaptureServer(): Promise<{ server: Server; url: string; received: Captured[] }> {
  const received: Captured[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      try {
        received.push({ headers: req.headers, body, json: JSON.parse(body) });
      } catch (err) {
        console.error("Capture server got non-JSON body", err);
      }
      res.writeHead(200).end("ok");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/hook`, received });
    });
  });
}

function verifySignature(captured: Captured, secret: string): boolean {
  const header = String(captured.headers["x-atrium-signature"] ?? "");
  const match = header.match(/^t=(\d+),v1=([a-f0-9]{64})$/);
  if (!match) return false;
  const expected = createHmac("sha256", secret).update(`${match[1]}.${captured.body}`).digest("hex");
  return expected === match[2];
}

test.describe("Integrations", () => {
  let capture: Awaited<ReturnType<typeof startCaptureServer>>;

  test.beforeAll(async () => {
    capture = await startCaptureServer();
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => capture.server.close(() => resolve()));
  });

  test("anonymous requests are rejected", async ({ playwright }) => {
    const bare = await playwright.request.newContext({ storageState: { cookies: [], origins: [] } });
    const res = await bare.get(`${API}/integrations`);
    expect(res.status()).toBe(401);
    await bare.dispose();
  });

  test("settings tab is reachable and matches the plan", async ({ page, request }) => {
    const features = await getPlanFeatures(request);
    await page.goto("/dashboard/settings/account");
    await page.getByRole("link", { name: "Integrations" }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings\/integrations/);
    if (features.integrations) {
      await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
    } else {
      await expect(page.getByTestId("integrations-locked")).toBeVisible();
    }
  });

  test("rejects a Slack URL that isn't a Slack webhook", async ({ request }) => {
    const features = await getPlanFeatures(request);
    test.skip(!features.integrations, "Integrations need a paid plan on this workspace");
    const res = await request.post(`${API}/integrations`, {
      data: { type: "slack", name: "Bad", url: "https://example.com/hook", events: [] },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toContain("hooks.slack.com");
  });

  test("webhook receives signed test and real events, logs them, and can be disabled and deleted", async ({
    page, request,
  }) => {
    test.setTimeout(60_000);
    const features = await getPlanFeatures(request);
    test.skip(!features.integrations, "Integrations need a paid plan on this workspace");

    const projectId = await getOrCreateProject(request, "E2E Integrations");
    const name = `E2E webhook ${Date.now()}`;

    // Create through the UI
    await page.goto("/dashboard/settings/integrations");
    await page.getByRole("button", { name: "Add integration" }).click();
    const form = page.getByTestId("integration-form");
    await form.getByRole("radio", { name: "Webhook" }).click();
    await form.getByLabel("Name").fill(name);
    await form.getByLabel("Webhook URL").fill(capture.url);
    // "Projects" is the first group: update posted + comment added
    await form.getByRole("button", { name: "Select all" }).first().click();
    await form.getByRole("button", { name: "Add integration" }).click();

    // The signing secret is shown once
    const secret = (await page.getByTestId("signing-secret-value").innerText()).trim();
    expect(secret).toMatch(/^whsec_/);
    await page.getByRole("button", { name: "I have saved it" }).click();

    const row = page.getByTestId("integration-row").filter({ hasText: name });
    await expect(row).toContainText("2 events");
    await expect(row).toContainText("All projects");
    await expect(row).not.toContainText("/hook");

    // Send test
    await row.getByRole("button", { name: "Send test" }).click();
    await expect(page.getByText(/test delivered/i)).toBeVisible({ timeout: 10_000 });
    const ping = capture.received.find((c) => c.json.event === "test.ping");
    expect(ping).toBeDefined();
    expect(verifySignature(ping!, secret)).toBe(true);
    expect(ping!.headers["x-atrium-event"]).toBe("test.ping");

    // A real event: posting a project update
    const content = `Integration e2e update ${Date.now()}`;
    const posted = await request.post(`${API}/updates?projectId=${projectId}`, {
      multipart: { content },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    expect(posted.ok()).toBe(true);

    await expect
      .poll(() => capture.received.find((c) => c.json.detail === content), { timeout: 10_000 })
      .toBeDefined();
    const delivered = capture.received.find((c) => c.json.detail === content)!;
    expect(delivered.json.event).toBe("project.update_posted");
    expect(delivered.json.project?.id).toBe(projectId);
    expect(delivered.headers["x-atrium-delivery"]).toBeTruthy();
    expect(verifySignature(delivered, secret)).toBe(true);

    // The delivery log shows it
    await row.getByRole("button", { name: "Deliveries" }).click();
    const logRow = row.getByTestId("delivery-row").filter({ hasText: "project.update_posted" }).first();
    await expect(logRow).toContainText("success");
    await expect(logRow).toContainText("HTTP 200");

    // Disabled destinations receive nothing
    await row.getByLabel(`Enable ${name}`).uncheck();
    await expect(row.getByLabel(`Enable ${name}`)).not.toBeChecked();
    const quiet = `Integration e2e quiet ${Date.now()}`;
    await request.post(`${API}/updates?projectId=${projectId}`, {
      multipart: { content: quiet },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    await page.waitForTimeout(2000);
    expect(capture.received.some((c) => c.json.detail === quiet)).toBe(false);

    // Delete
    await row.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();
    await expect(page.getByText("Integration deleted")).toBeVisible();
    await expect(page.getByTestId("integration-row").filter({ hasText: name })).toHaveCount(0);
  });
});
