import { test, expect } from "@playwright/test";
import { getCsrfToken, openSearchPalette } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Contacts list", () => {
  test("add a lead and see it in the list", async ({ page }) => {
    const name = `Lead ${Date.now()}`;
    await page.goto("/dashboard/contacts");
    await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();

    await page.getByRole("button", { name: /add contact/i }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: /^add contact$/i }).last().click();

    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByText("Lead", { exact: true })).toBeVisible();
  });

  test("search finds by company", async ({ page, request }) => {
    const stamp = Date.now();
    const company = `Acme${stamp}`;
    const name = `Person ${stamp}`;
    const res = await request.post(`${API}/contacts`, {
      data: { name, companyName: company },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    expect(res.ok()).toBeTruthy();

    await page.goto("/dashboard/contacts");
    await page.getByPlaceholder(/search name, company, email/i).fill(company);
    await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
  });

  test("export downloads a CSV with header row", async ({ page }) => {
    await page.goto("/dashboard/contacts");
    await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByTitle("Export CSV").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain(".csv");

    const path = await download.path();
    if (path) {
      const fs = await import("fs");
      expect(fs.readFileSync(path, "utf-8")).toContain("Name,Email");
    }
  });

  test("import creates contacts and reports skipped duplicates", async ({ page }) => {
    const stamp = Date.now();
    const csv = [
      "Name,E-mail,Company Name",
      `Import One ${stamp},one-${stamp}@example.com,ImportCo${stamp}`,
      `Import Dupe ${stamp},one-${stamp}@example.com,ImportCo${stamp}`,
    ].join("\n");

    await page.goto("/dashboard/contacts");
    await page.getByRole("button", { name: /^import$/i }).click();
    await page.getByLabel("CSV file").setInputFiles({
      name: "contacts.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });

    // Headers are auto-matched by name.
    await expect(page.getByLabel("Field for Name")).toHaveValue("name");
    await expect(page.getByLabel("Field for E-mail")).toHaveValue("email");
    await expect(page.getByLabel("Field for Company Name")).toHaveValue("company");

    await page.getByRole("button", { name: /import 2 contacts/i }).click();
    await expect(page.getByTestId("import-result")).toContainText("Imported 1 contact, skipped 1");
    await expect(page.getByText(/email already exists/i)).toBeVisible();

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("row", { name: new RegExp(`Import One ${stamp}`) })).toBeVisible();
  });

  test("global search finds a contact", async ({ page, request }) => {
    const name = `Searchable${Date.now()}`;
    const res = await request.post(`${API}/contacts`, {
      data: { name },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    expect(res.ok()).toBeTruthy();

    await page.goto("/dashboard");
    const input = await openSearchPalette(page);
    await input.fill(name);
    await expect(page.getByText("Contacts", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  });
});
