import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { createOwner, getCsrfToken, openSearchPalette } from "./helpers";

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

  test("follow-up due today shows Today, past shows Overdue", async ({ page, request }) => {
    const stamp = Date.now();
    const noon = (offsetDays: number): string => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      d.setHours(12, 0, 0, 0);
      return d.toISOString();
    };
    for (const [label, offset] of [["Today", 0], ["Late", -3]] as const) {
      const created = await request.post(`${API}/contacts`, {
        data: { name: `${label} ${stamp}` },
        headers: { "x-csrf-token": getCsrfToken() },
      });
      const { id } = await created.json();
      const set = await request.put(`${API}/contacts/${id}/follow-up`, {
        data: { followUpAt: noon(offset) },
        headers: { "x-csrf-token": getCsrfToken() },
      });
      expect(set.ok()).toBeTruthy();
    }

    await page.goto("/dashboard/contacts");
    await page.getByPlaceholder(/search name, company, email/i).fill(String(stamp));
    await expect(page.getByRole("row", { name: new RegExp(`Today ${stamp}`) })).toContainText("Today");
    await expect(page.getByRole("row", { name: new RegExp(`Late ${stamp}`) })).toContainText("Overdue");
  });

  test("companies tab shows people and paid columns", async ({ page, request }) => {
    const company = `TabCo${Date.now()}`;
    await request.post(`${API}/contacts`, {
      data: { name: `Member ${company}`, companyName: company },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    await page.goto("/dashboard/contacts");
    await page.getByRole("button", { name: "Companies" }).click();
    await expect(page.getByRole("columnheader", { name: "Paid, all time" })).toBeVisible();
    await expect(page.getByRole("link", { name: company })).toBeVisible();
  });
});

async function createContact(
  request: APIRequestContext,
  data: Record<string, string>,
): Promise<string> {
  const res = await request.post(`${API}/contacts`, {
    data,
    headers: { "x-csrf-token": getCsrfToken() },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id;
}

function localDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

test.describe("Contact page", () => {
  test("add note shows in timeline", async ({ page, request }) => {
    const id = await createContact(request, { name: `Noted ${Date.now()}` });
    await page.goto(`/dashboard/contacts/${id}`);

    await page.getByLabel("Add a note").fill("Called, wants a quote");
    await page.getByRole("button", { name: "Add note" }).click();

    const note = page.getByTestId("timeline-note");
    await expect(note).toContainText("Called, wants a quote");
    await expect(page.getByTestId("timeline-event").first()).toContainText("(auto)");
  });

  test("repeating follow-up: set 3 months, Done moves date", async ({ page, request }) => {
    const id = await createContact(request, { name: `Repeat ${Date.now()}` });
    await page.goto(`/dashboard/contacts/${id}`);

    const today = new Date();
    await page.getByLabel("Follow-up date").fill(localDate(today));
    await page.getByLabel("Repeat").selectOption({ label: "Every 3 months" });
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();

    await page.getByRole("button", { name: "Done" }).click();

    // The API moves the date to start of today (UTC) + 90 days.
    const utcMidnight = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    const expected = localDate(new Date(utcMidnight.getTime() + 90 * 24 * 60 * 60 * 1000));
    await expect(page.getByLabel("Follow-up date")).toHaveValue(expected);
    await expect(page.getByLabel("Repeat")).toHaveValue("90");
  });

  test("revenue strip hidden with no payments, shown after an invoice on a linked project is marked paid", async ({
    page,
    request,
  }) => {
    const headers = { "x-csrf-token": getCsrfToken() };
    const id = await createContact(request, { name: `Revenue ${Date.now()}` });
    const projectRes = await request.post(`${API}/projects`, {
      data: { name: `Revenue project ${Date.now()}` },
      headers,
    });
    expect(projectRes.ok()).toBeTruthy();
    const project = await projectRes.json();
    const link = await request.post(`${API}/contacts/${id}/projects/${project.id}`, { headers });
    expect(link.ok()).toBeTruthy();

    await page.goto(`/dashboard/contacts/${id}`);
    await expect(page.getByRole("link", { name: new RegExp(project.name) })).toBeVisible();
    await expect(page.getByTestId("revenue-strip")).toHaveCount(0);

    const invoiceRes = await request.post(`${API}/invoices`, {
      data: {
        projectId: project.id,
        lineItems: [{ description: "Work", quantity: 1, unitPrice: 120000 }],
      },
      headers,
    });
    expect(invoiceRes.ok()).toBeTruthy();
    const invoice = await invoiceRes.json();
    for (const body of [{ status: "sent" }, { status: "paid", paidAt: new Date().toISOString() }]) {
      const res = await request.put(`${API}/invoices/${invoice.id}`, { data: body, headers });
      expect(res.ok()).toBeTruthy();
    }

    await page.reload();
    const strip = page.getByTestId("revenue-strip");
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("Paid, all time");
    await expect(strip).toContainText("$1,200.00");
    await expect(strip).toHaveAttribute("title", "Paid invoices on this contact's projects");
  });

  test("invite to portal keeps notes", async ({ browser }) => {
    const { context, page } = await createOwner(browser, "contact-invite");
    const csrf = (await context.cookies()).find((c) => c.name === "csrf-token")?.value ?? "";
    const email = `portal-${Date.now()}@test.local`;
    const created = await page.request.post(`${API}/contacts`, {
      data: { name: "Portal Person", email },
      headers: { "x-csrf-token": csrf },
    });
    expect(created.ok()).toBeTruthy();
    const { id } = await created.json();
    await page.request.post(`${API}/contacts/${id}/notes`, {
      data: { content: "Met at the conference" },
      headers: { "x-csrf-token": csrf },
    });

    await page.goto(`/dashboard/contacts/${id}`);
    await expect(page.getByTestId("contact-status")).toHaveText("Lead");
    await page.getByRole("button", { name: "Invite to portal" }).click();
    await expect(page.getByText("Invitation sent")).toBeVisible();

    const invitations = await (await page.request.get(`${API}/clients/invitations`)).json();
    const invite = invitations.find((i: { email: string }) => i.email === email);
    expect(invite).toBeTruthy();

    const clientCtx = await browser.newContext({ storageState: undefined });
    const clientPage = await clientCtx.newPage();
    await clientPage.goto(invite.inviteLink);
    await clientPage.locator("#name").fill("Portal Person");
    await clientPage.locator("#email").fill(email);
    await clientPage.locator("#password").fill("Client123!");
    await clientPage.getByRole("button", { name: /create account & join/i }).click();
    await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });
    await clientCtx.close();

    await page.reload();
    await expect(page.getByTestId("timeline-note")).toContainText("Met at the conference");
    await expect(page.getByTestId("contact-status")).toHaveText("Client");
    await expect(page.getByText("has portal login")).toBeVisible();
    await expect(page.getByRole("button", { name: "Invite to portal" })).toHaveCount(0);
    await context.close();
  });
});

test.describe("Company page", () => {
  test("company page totals two contacts on one project once", async ({ page, request }) => {
    const headers = { "x-csrf-token": getCsrfToken() };
    const stamp = Date.now();
    const company = `Totals Co ${stamp}`;
    const first = await createContact(request, { name: `First ${stamp}`, companyName: company });
    const second = await createContact(request, { name: `Second ${stamp}`, companyName: company });

    const project = await (
      await request.post(`${API}/projects`, { data: { name: `Shared project ${stamp}` }, headers })
    ).json();
    for (const id of [first, second]) {
      const link = await request.post(`${API}/contacts/${id}/projects/${project.id}`, { headers });
      expect(link.ok()).toBeTruthy();
    }
    const invoice = await (
      await request.post(`${API}/invoices`, {
        data: {
          projectId: project.id,
          lineItems: [{ description: "Work", quantity: 1, unitPrice: 120000 }],
        },
        headers,
      })
    ).json();
    for (const body of [{ status: "sent" }, { status: "paid", paidAt: new Date().toISOString() }]) {
      const res = await request.put(`${API}/invoices/${invoice.id}`, { data: body, headers });
      expect(res.ok()).toBeTruthy();
    }

    await page.goto("/dashboard/contacts");
    await page.getByRole("button", { name: "Companies" }).click();
    await page.getByRole("link", { name: company }).click();

    await expect(page.getByRole("heading", { name: company })).toBeVisible();
    const strip = page.getByTestId("revenue-strip");
    await expect(strip).toContainText("$1,200.00");
    await expect(strip).not.toContainText("$2,400.00");
    await expect(page.getByRole("link", { name: `First ${stamp}` })).toBeVisible();
    await expect(page.getByRole("link", { name: `Second ${stamp}` })).toBeVisible();
  });

  test("edit notes and delete a company", async ({ page, request }) => {
    const stamp = Date.now();
    const company = `Notes Co ${stamp}`;
    const personId = await createContact(request, { name: `Member ${stamp}`, companyName: company });
    const companies = await (await request.get(`${API}/companies?limit=100`)).json();
    const id = companies.data.find((c: { name: string }) => c.name === company).id;

    await page.goto(`/dashboard/contacts/companies/${id}`);
    await page.getByLabel("Notes").fill("Prefers email");
    await page.getByLabel("Notes").blur();
    await expect(page.getByText("Notes saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Notes")).toHaveValue("Prefers email");

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete" }).last().click();
    await expect(page).toHaveURL(/\/dashboard\/contacts\?tab=companies/);
    await expect(page.getByRole("link", { name: company })).toHaveCount(0);

    const person = await (await request.get(`${API}/contacts/${personId}`)).json();
    expect(person.company).toBeNull();
  });
});

test.describe("Lead source settings", () => {
  test("rename a lead source in settings", async ({ page, request }) => {
    const stamp = Date.now();
    const created = await request.post(`${API}/lead-sources`, {
      data: { name: `Podcast ${stamp}` },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    expect(created.ok()).toBeTruthy();

    await page.goto("/dashboard/settings/workspace");
    await page.getByRole("button", { name: `Edit Podcast ${stamp}` }).click();
    const input = page.getByLabel(`Rename Podcast ${stamp}`);
    await input.fill(`Webinar ${stamp}`);
    await input.press("Enter");

    await expect(page.getByText("Lead source renamed")).toBeVisible();
    await expect(page.getByText(`Webinar ${stamp}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Podcast ${stamp}`, { exact: true })).toHaveCount(0);
  });
});
