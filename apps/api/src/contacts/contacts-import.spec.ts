import { describe, expect, it } from "bun:test";
import { parseImportDate, parseWholeNumber, phoneLabel, planImport } from "./contacts-import";
import type { PlannedRow } from "./contacts-import";
import type { ImportMapping } from "./contacts-csv";

function plan(csv: string[][], mapping: ImportMapping): PlannedRow[] {
  const [headers, ...rows] = csv;
  return planImport(headers, rows, mapping);
}

function draftOf(row: PlannedRow) {
  if (!("draft" in row)) throw new Error(`row ${row.row} was skipped: ${row.skip}`);
  return row.draft;
}

describe("phoneLabel", () => {
  it("names a number after its column, without the word phone", () => {
    expect(phoneLabel("Mobile")).toBe("Mobile");
    expect(phoneLabel("Work Phone")).toBe("Work");
    expect(phoneLabel("home_phone_number")).toBe("Home");
    expect(phoneLabel("mobile phone")).toBe("Mobile");
  });

  it("falls back to Phone for a generic header and keeps labels short", () => {
    expect(phoneLabel("Phone")).toBe("Phone");
    expect(phoneLabel("Telephone Number")).toBe("Phone");
    expect(phoneLabel("x".repeat(40))).toHaveLength(30);
  });
});

describe("parseImportDate", () => {
  it("reads ISO, US month/day/year and timestamp dates as YYYY-MM-DD", () => {
    expect(parseImportDate("2026-11-05")).toBe("2026-11-05");
    expect(parseImportDate("11/5/2026")).toBe("2026-11-05");
    expect(parseImportDate("2026/11/05")).toBe("2026-11-05");
    expect(parseImportDate("2026-11-05T09:30:00Z")).toBe("2026-11-05");
  });

  it("rejects anything else, including impossible days", () => {
    expect(parseImportDate("next week")).toBeNull();
    expect(parseImportDate("2026-02-30")).toBeNull();
    expect(parseImportDate("13/1/2026")).toBeNull();
  });
});

describe("parseWholeNumber", () => {
  it("strips currency symbols, separators and decimals", () => {
    expect(parseWholeNumber("$1,500,000")).toBe(1500000);
    expect(parseWholeNumber("1500000.00")).toBe(1500000);
    expect(parseWholeNumber(" 42 ")).toBe(42);
    expect(parseWholeNumber("€ 2 500")).toBe(2500);
  });

  it("rejects text, negatives and out-of-range values", () => {
    expect(parseWholeNumber("lots")).toBeNull();
    expect(parseWholeNumber("-5")).toBeNull();
    expect(parseWholeNumber("9999999999")).toBeNull();
  });
});

describe("planImport", () => {
  it("collects every phone column with its header as the label, skipping blanks and repeats", () => {
    const rows = plan(
      [
        ["Name", "Mobile", "Work Phone", "Home Phone"],
        ["Ann", "+1 555 0100", "+1 555 0200", "+1 555 0100"],
        ["Bo", "", "+1 555 0300", ""],
      ],
      { Name: "name", Mobile: "phone", "Work Phone": "phone", "Home Phone": "phone" },
    );
    expect(draftOf(rows[0]).contact.phones).toEqual([
      { label: "Mobile", number: "+1 555 0100" },
      { label: "Work", number: "+1 555 0200" },
    ]);
    expect(draftOf(rows[1]).contact.phones).toEqual([{ label: "Work", number: "+1 555 0300" }]);
  });

  it("maps About, Referred by, follow-up and company size", () => {
    const [row] = plan(
      [
        ["Name", "Company", "Bio", "Referrer", "Follow up", "Revenue", "Employees"],
        ["Ann", "Acme", "Runs ops", "bo@x.com", "11/5/2026", "$2,000,000", "40"],
      ],
      {
        Name: "name",
        Company: "company",
        Bio: "description",
        Referrer: "referredBy",
        "Follow up": "followUpAt",
        Revenue: "companyRevenue",
        Employees: "companyEmployees",
      },
    );
    const draft = draftOf(row);
    expect(draft.contact.description).toBe("Runs ops");
    expect(draft.referredBy).toBe("bo@x.com");
    expect(draft.followUpAt).toBe("2026-11-05");
    expect(draft.company).toEqual({ annualRevenue: 2000000, employeeCount: 40 });
    expect(row.warnings).toEqual([]);
  });

  it("keeps the row but warns about values it can't use", () => {
    const [row] = plan(
      [
        ["Name", "Follow up", "Revenue", "Employees", "LinkedIn"],
        ["Ann", "soon", "lots", "40", "not a link"],
      ],
      {
        Name: "name",
        "Follow up": "followUpAt",
        Revenue: "companyRevenue",
        Employees: "companyEmployees",
        LinkedIn: "socialLinks",
      },
    );
    expect(draftOf(row).followUpAt).toBeNull();
    expect(row.warnings).toEqual([
      'Social link "not" isn\'t a web address; left out',
      'Social link "a" isn\'t a web address; left out',
      'Social link "link" isn\'t a web address; left out',
      'Follow-up date "soon" isn\'t a date; left out',
      'Annual revenue "lots" isn\'t a number; left out',
      "No company to attach annual revenue and employees to; left out",
    ]);
  });

  it("skips rows with no name, a bad rating or email, or an email seen earlier in the file", () => {
    const rows = plan(
      [
        ["Name", "Email", "Rating"],
        ["", "a@x.com", ""],
        ["Bo", "b@x.com", "lukewarm"],
        ["Cy", "nope", ""],
        ["Di", "D@x.com", "hot"],
        ["Ed", "d@X.com", ""],
      ],
      { Name: "name", Email: "email", Rating: "rating" },
    );
    expect(rows.map((r) => ("skip" in r ? r.skip : "ok"))).toEqual([
      "Missing name",
      "Invalid rating",
      "Invalid email",
      "ok",
      "Email already exists",
    ]);
    expect(rows.map((r) => r.row)).toEqual([2, 3, 4, 5, 6]);
    expect(draftOf(rows[3]).contact).toMatchObject({ name: "Di", email: "d@x.com", rating: "hot" });
  });
});
