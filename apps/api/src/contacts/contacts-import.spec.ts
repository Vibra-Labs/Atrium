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
    expect(phoneLabel("Phone 2")).toBe("Phone");
    expect(phoneLabel("Phone 1 - Value")).toBe("Phone");
    expect(phoneLabel("Business Phone")).toBe("Business");
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

  it("reads day/month/year when asked", () => {
    expect(parseImportDate("05/11/2026", true)).toBe("2026-11-05");
    expect(parseImportDate("2026-11-05", true)).toBe("2026-11-05");
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

  it("reads European separators: dots or commas before groups of three are thousands", () => {
    expect(parseWholeNumber("€2.500")).toBe(2500);
    expect(parseWholeNumber("1.234.567")).toBe(1234567);
    expect(parseWholeNumber("2,500")).toBe(2500);
    expect(parseWholeNumber("1,5")).toBe(2);
    expect(parseWholeNumber("1.500,75")).toBe(1501);
    expect(parseWholeNumber("1,500.75")).toBe(1501);
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

  it("skips rows with no name, a bad rating or email; repeats are left to the writer", () => {
    const rows = plan(
      [
        ["Name", "Email", "Rating"],
        ["", "a@x.com", ""],
        ["Bo", "b@x.com", "lukewarm"],
        ["Cy", "nope", ""],
        ["Di", "D@x.com", "hot"],
        // Only a row that is actually created makes a later one a duplicate.
        ["Ed", "d@X.com", ""],
      ],
      { Name: "name", Email: "email", Rating: "rating" },
    );
    expect(rows.map((r) => ("skip" in r ? r.skip : "ok"))).toEqual([
      "Missing name",
      "Invalid rating",
      "Invalid email",
      "ok",
      "ok",
    ]);
    expect(rows.map((r) => r.row)).toEqual([2, 3, 4, 5, 6]);
    expect(draftOf(rows[3]).contact).toMatchObject({ name: "Di", email: "d@x.com", rating: "hot" });
  });

  it("undoes the export's spreadsheet-formula guard (a leading ' before = + - @)", () => {
    const [row] = plan(
      [["Name", "Phone", "Notes"], ["'=Ann", "'+1 555 0100", "'-not a formula"]],
      { Name: "name", Phone: "phone", Notes: "notes" },
    );
    expect(draftOf(row).contact.name).toBe("=Ann");
    expect(draftOf(row).contact.phones).toEqual([{ label: "Phone", number: "+1 555 0100" }]);
    expect(draftOf(row).notes).toBe("-not a formula");
  });

  it("splits our own export's All phones column into labelled numbers, ahead of the plain Phone column", () => {
    const [row] = plan(
      [
        ["Name", "Phone", "All phones"],
        ["Ann", "+1 555 0100", "Mobile: +1 555 0100; Work: +1 555 0200"],
      ],
      { Name: "name", Phone: "phone", "All phones": "phone" },
    );
    expect(draftOf(row).contact.phones).toEqual([
      { label: "Mobile", number: "+1 555 0100" },
      { label: "Work", number: "+1 555 0200" },
    ]);
  });

  it("reads a day-first date column when any of its dates can only be day-first", () => {
    const rows = plan(
      [["Name", "Follow up"], ["Ann", "25/12/2026"], ["Bo", "05/11/2026"]],
      { Name: "name", "Follow up": "followUpAt" },
    );
    expect(rows.map((r) => draftOf(r).followUpAt)).toEqual(["2026-12-25", "2026-11-05"]);
  });

  it("imports a follow-up repeat in days, warning about one the app doesn't offer", () => {
    const rows = plan(
      [["Name", "Follow up", "Repeat"], ["Ann", "2026-11-05", "30"], ["Bo", "2026-11-05", "7"], ["Cy", "", "30"]],
      { Name: "name", "Follow up": "followUpAt", Repeat: "followUpEveryDays" },
    );
    expect(draftOf(rows[0]).followUpEveryDays).toBe(30);
    expect(draftOf(rows[1]).followUpEveryDays).toBeNull();
    expect(rows[1].warnings).toEqual(['Follow-up repeat "7" isn\'t one of 14, 30, 90, 180, 365 days; left out']);
    expect(rows[2].warnings).toEqual(["Follow-up repeat needs a follow-up date; left out"]);
  });
});
