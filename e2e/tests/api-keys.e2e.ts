import { test, expect } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";

const API_URL = "http://localhost:3001";

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } },
};

/** Calls the MCP endpoint with only a bearer key: no cookies from the signed-in browser context. */
async function mcpInitialize(request: APIRequestContext, key: string): Promise<APIResponse> {
  return request.post(`${API_URL}/api/mcp`, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    data: INITIALIZE,
  });
}

test.describe("API keys and MCP", () => {
  test("settings tab is reachable", async ({ page }) => {
    await page.goto("/dashboard/settings/account");
    await page.getByRole("link", { name: "API & MCP" }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings\/api-keys/);
    await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connect an AI assistant" })).toBeVisible();
    await expect(page.getByTestId("mcp-url")).toContainText("/api/mcp");
  });

  test("create a key, use it over MCP, revoke it, and it stops working", async ({ page, playwright }) => {
    // The trailing poll alone budgets up to 40s (see below); the default 30s
    // per-test timeout isn't enough to also cover the steps before it.
    test.setTimeout(75_000);
    const keyName = `E2E key ${Date.now()}`;
    await page.goto("/dashboard/settings/api-keys");
    await expect(page.getByText("Loading...").first()).not.toBeVisible({ timeout: 5000 });

    await page.getByPlaceholder("Key name (e.g. Claude agent)").fill(keyName);
    await page.getByRole("button", { name: "Create key" }).click();
    await expect(page.getByText(/api key created/i)).toBeVisible({ timeout: 5000 });

    // Shown exactly once, in full
    const key = (await page.getByTestId("new-api-key").innerText()).trim();
    expect(key).toMatch(/^atr_[A-Za-z0-9_-]{43}$/);

    // The table shows only the prefix
    const row = page.getByRole("row").filter({ hasText: keyName });
    await expect(row).toContainText(`${key.slice(0, 12)}…`);
    await expect(row).not.toContainText(key);

    // After dismissing and reloading, the full key is gone for good
    await page.getByRole("button", { name: "I have saved it" }).click();
    await page.reload();
    await expect(page.getByTestId("new-api-key")).toHaveCount(0);

    // A cookie-less client can use the key
    const bare = await playwright.request.newContext({ storageState: { cookies: [], origins: [] } });
    const before = await mcpInitialize(bare, key);
    expect(before.status()).toBe(200);
    expect((await before.json()).result.serverInfo.name).toBe("atrium");

    // Revoke
    await page.getByRole("row").filter({ hasText: keyName }).getByRole("button", { name: /revoke/i }).click();
    await page.getByRole("button", { name: "Revoke" }).last().click();
    await expect(page.getByText(/api key revoked/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("row").filter({ hasText: keyName })).toHaveCount(0);

    // SessionMiddleware caches resolved keys for up to 30 seconds
    await expect
      .poll(async () => (await mcpInitialize(bare, key)).status(), { timeout: 40_000, intervals: [2_000] })
      .toBe(401);
    await bare.dispose();
  });

  test("MCP endpoint rejects requests without a key", async ({ playwright }) => {
    const bare = await playwright.request.newContext({ storageState: { cookies: [], origins: [] } });
    const res = await bare.post(`${API_URL}/api/mcp`, { data: INITIALIZE });
    expect(res.status()).toBe(401);
    expect(res.headers()["www-authenticate"]).toBe("Bearer");
    await bare.dispose();
  });
});
