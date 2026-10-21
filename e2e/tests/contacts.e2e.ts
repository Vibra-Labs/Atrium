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
    await page.getByLabel("First name").fill(name);
    await page.getByRole("button", { name: /^add contact$/i }).last().click();

    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByText("Lead", { exact: true })).toBeVisible();
  });

  test("add a contact with name parts, title, phones, links, rating and a note", async ({ page }) => {
    const first = `Ann${Date.now()}`;
    const name = `${first} Lee`;
    await page.goto("/dashboard/contacts");
    await page.getByRole("button", { name: /add contact/i }).click();

    await page.getByLabel("First name").fill(first);
    await page.getByLabel("Last name").fill("Lee");
    await page.getByLabel("Job title").fill("CTO");
    await page.getByLabel("Department").fill("Engineering");
    await page.getByLabel("Phone label 1").fill("Mobile");
    await page.getByLabel("Phone number 1").fill("+1 555 0100");
    await page.getByRole("button", { name: "+ Add phone" }).click();
    await page.getByLabel("Phone label 2").fill("Work");
    await page.getByLabel("Phone number 2").fill("+1 555 0200");
    await page.getByLabel("Social link 1").fill("https://www.linkedin.com/in/ann");
    await page.getByRole("button", { name: "+ Add link" }).click();
    await page.getByLabel("Social link 2").fill("https://ann.dev");
    await page.getByLabel("Rating", { exact: true }).selectOption("hot");
    await page.getByLabel(/^Note/).fill("Met at the expo");
    await page.getByRole("button", { name: /^add contact$/i }).last().click();

    await page.getByLabel("Filter by rating").selectOption("hot");
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row.getByTestId("contact-rating")).toHaveText("Hot");
    await row.getByRole("link", { name }).click();

    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByTestId("contact-role")).toHaveText("CTO · Engineering");
    await expect(page.getByTestId("contact-rating")).toHaveText("Hot");
    await expect(page.getByRole("link", { name: "+1 555 0100" })).toHaveAttribute("href", "tel:+15550100");
    await expect(page.getByRole("link", { name: "+1 555 0200" })).toHaveAttribute("href", "tel:+15550200");
    const linkedin = page.getByRole("link", { name: "linkedin.com" });
    await expect(linkedin).toHaveAttribute("href", "https://www.linkedin.com/in/ann");
    await expect(linkedin).toHaveAttribute("target", "_blank");
    await expect(linkedin).toHaveAttribute("rel", "noopener noreferrer");
    await expect(page.getByRole("link", { name: "ann.dev" })).toHaveAttribute("href", "https://ann.dev");
    await expect(page.getByTestId("timeline-note")).toContainText("Met at the expo");
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

  test("clicking anywhere on a contact row opens the contact", async ({ page, request }) => {
    const stamp = Date.now();
    const company = `Rowco${stamp}`;
    const name = `Rowclick ${stamp}`;
    const res = await request.post(`${API}/contacts`, {
      data: { name, companyName: company },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    expect(res.ok()).toBeTruthy();
    const { id } = await res.json();

    await page.goto("/dashboard/contacts");
    await page.getByPlaceholder(/search name, company, email/i).fill(company);
    // Click the company cell, not the name link.
    await page.getByTestId("contact-row").filter({ hasText: name }).getByText(company).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/contacts/${id}$`));
    await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
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

  test("import of a CRM export keeps Twitter handles and warns about a link it can't use", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const email = `zoho-${stamp}@example.com`;
    const csv = [
      "First Name,Last Name,Email,Twitter,Social",
      `Zed${stamp},Lee,${email},@zed_co,not-a-link`,
    ].join("\n");

    await page.goto("/dashboard/contacts");
    await page.getByRole("button", { name: /^import$/i }).click();
    await page.getByLabel("CSV file").setInputFiles({
      name: "zoho.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await expect(page.getByLabel("Field for First Name")).toHaveValue("firstName");
    await expect(page.getByLabel("Field for Twitter")).toHaveValue("socialLinks");

    await page.getByRole("button", { name: /import 1 contact/i }).click();
    await expect(page.getByTestId("import-result")).toContainText("Imported 1 contact, skipped 0");
    await expect(page.getByTestId("import-warnings")).toContainText("not-a-link");

    const list = await (
      await request.get(`${API}/contacts?search=${encodeURIComponent(email)}`)
    ).json();
    expect(list.data[0].name).toBe(`Zed${stamp} Lee`);
    expect(list.data[0].socialLinks).toEqual(["https://x.com/zed_co"]);
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
    // Scoped to the palette: the sidebar also has a "Contacts" link.
    const palette = page.getByRole("dialog", { name: "Global search" });
    await expect(palette.getByText("Contacts", { exact: true })).toBeVisible();
    await expect(palette.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  });

  test("follow-up due today shows Today, past shows Overdue", async ({ page, request }) => {
    const stamp = Date.now();
    // Follow-ups are plain dates; "Today" is the browser's local date.
    const day = (offsetDays: number): string => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      return localDate(d);
    };
    for (const [label, offset] of [["Today", 0], ["Late", -3]] as const) {
      const created = await request.post(`${API}/contacts`, {
        data: { name: `${label} ${stamp}` },
        headers: { "x-csrf-token": getCsrfToken() },
      });
      const { id } = await created.json();
      const set = await request.put(`${API}/contacts/${id}/follow-up`, {
        data: { followUpAt: day(offset) },
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
    // Search rather than rely on the company landing on page 1.
    await page.getByPlaceholder("Search companies").fill(company);
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

  test("Cmd/Ctrl+Enter in the note box adds the note", async ({ page, request }) => {
    const id = await createContact(request, { name: `Keyed ${Date.now()}` });
    await page.goto(`/dashboard/contacts/${id}`);

    const box = page.getByLabel("Add a note");
    await box.fill("Sent the proposal");
    await box.press("ControlOrMeta+Enter");

    await expect(page.getByTestId("timeline-note")).toContainText("Sent the proposal");
    await expect(box).toHaveValue("");
  });

  test("details show labelled values", async ({ page, request }) => {
    const id = await createContact(request, { name: `Detailed ${Date.now()}`, email: `d${Date.now()}@test.local` });
    await page.goto(`/dashboard/contacts/${id}`);

    const details = page.getByTestId("contact-details");
    await expect(details.getByText("Email", { exact: true })).toBeVisible();
    await expect(details.getByRole("link", { name: /@test\.local$/ })).toHaveAttribute("href", /^mailto:/);
  });

  test("repeating follow-up: set 3 months, Done moves date", async ({ page, request }) => {
    const id = await createContact(request, { name: `Repeat ${Date.now()}` });
    await page.goto(`/dashboard/contacts/${id}`);

    const today = new Date();
    await page.getByLabel("Follow-up date").fill(localDate(today));
    await page.getByLabel("Repeat").selectOption({ label: "Every 3 months" });
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    // Leaving the date input saves on blur and the select saves on change; the repeat must win.
    await expect
      .poll(async () => (await (await request.get(`${API}/contacts/${id}`)).json()).followUpEveryDays)
      .toBe(90);

    await page.getByRole("button", { name: "Done" }).click();

    // The picked date is stored as noon UTC; Done moves it 90 calendar days on.
    const picked = new Date(`${localDate(today)}T12:00:00Z`);
    const expected = new Date(picked.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await expect
      .poll(async () => (await (await request.get(`${API}/contacts/${id}`)).json()).followUpAt)
      .toBe(`${expected}T12:00:00.000Z`);
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

  test("at the client limit, invite becomes an upgrade link", async ({ page, request }) => {
    const id = await createContact(request, {
      name: `Limit ${Date.now()}`,
      email: `limit-${Date.now()}@example.com`,
    });
    await page.route("**/api/health/config", (route) =>
      route.fulfill({ json: { billingEnabled: true, signupEnabled: true } }),
    );
    await page.route("**/api/billing/subscription", (route) =>
      route.fulfill({
        json: {
          subscription: { plan: { maxMembers: 1, maxClients: 5 } },
          usage: { members: 1, clients: 5 },
        },
      }),
    );

    await page.goto(`/dashboard/contacts/${id}`);
    const upgrade = page.getByRole("link", { name: "Upgrade to invite" });
    await expect(upgrade).toBeVisible();
    await expect(upgrade).toHaveAttribute("href", "/dashboard/settings/billing?reason=clients");
    await expect(page.getByRole("button", { name: "Invite to portal" })).toHaveCount(0);
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
    await expect(page.getByText("Invitation created")).toBeVisible();
    // Email may not be delivered in test environments; the link is always offered.
    await expect(page.getByTestId("pending-invite")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy invite link" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend invite" })).toBeVisible();

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
    await expect(page.getByTestId("portal-access")).toContainText("Portal access");
    await expect(page.getByRole("button", { name: "Invite to portal" })).toHaveCount(0);
    await context.close();
  });
});

test.describe("Company page", () => {
  // Revenue and employee counts are grouped by the browser locale ("1,500,000").
  test.use({ locale: "en-US" });

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
    await page.getByPlaceholder("Search companies").fill(company);
    await page.getByRole("link", { name: company }).click();

    await expect(page.getByRole("heading", { name: company })).toBeVisible();
    const strip = page.getByTestId("revenue-strip");
    await expect(strip).toContainText("$1,200.00");
    await expect(strip).not.toContainText("$2,400.00");
    await expect(page.getByRole("link", { name: `First ${stamp}` })).toBeVisible();
    await expect(page.getByRole("link", { name: `Second ${stamp}` })).toBeVisible();
  });

  test("annual revenue and employee count persist after reload, and empty clears", async ({ page, request }) => {
    const stamp = Date.now();
    const personId = await createContact(request, { name: `Size ${stamp}`, companyName: `Size Co ${stamp}` });
    const id = (await (await request.get(`${API}/contacts/${personId}`)).json()).company.id;

    await page.goto(`/dashboard/contacts/companies/${id}`);
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Annual revenue").fill("1500000");
    await page.getByLabel("No. of employees").fill("42");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Company updated")).toBeVisible();

    await page.reload();
    const size = page.getByTestId("company-size");
    await expect(size).toContainText("1,500,000");
    await expect(size).toContainText("42");

    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByLabel("Annual revenue")).toHaveValue("1500000");
    await page.getByLabel("Annual revenue").fill("");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(size).not.toContainText("Annual revenue");
    await expect(size).toContainText("42");
    const company = await (await request.get(`${API}/companies/${id}`)).json();
    expect(company.annualRevenue).toBeNull();
    expect(company.employeeCount).toBe(42);
  });

  test("edit notes and delete a company", async ({ page, request }) => {
    const stamp = Date.now();
    const company = `Notes Co ${stamp}`;
    const personId = await createContact(request, { name: `Member ${stamp}`, companyName: company });
    const id = (await (await request.get(`${API}/contacts/${personId}`)).json()).company.id;

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
