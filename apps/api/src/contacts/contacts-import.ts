import { isEmail } from "class-validator";
import { FOLLOW_UP_REPEAT_DAYS } from "@atrium/shared";
import type { ContactPhone, ContactStatus } from "@atrium/shared";
import { normalizeEmail } from "../contact-sync/contact-sync.service";
import type { ImportField, ImportMapping } from "./contacts-csv";
import {
  MAX_PHONES,
  NAME_PART_MAX,
  PHONE_LABEL_MAX,
  PHONE_NUMBER_MAX,
  LEGACY_PHONE_LABEL,
  importSocialLinks,
  parseRating,
} from "./contact-fields";
import { COMPANY_NUMBER_MAX, CONTACT_DESCRIPTION_MAX, LEAD_SOURCE_NAME_MAX } from "./contacts.dto";
import type { CreateContactDto } from "./contacts.dto";

/** What one CSV row will become; written by ContactsService.importCsv. */
export interface ImportDraft {
  contact: CreateContactDto;
  tags: string[];
  notes: string;
  /** Name or email of an existing contact; resolved when the row is written. */
  referredBy: string;
  /** YYYY-MM-DD */
  followUpAt: string | null;
  /** One of FOLLOW_UP_REPEAT_DAYS, only with a follow-up date. */
  followUpEveryDays: number | null;
  /** Filled in on the contact's company only where it has no value yet. */
  company: { annualRevenue?: number; employeeCount?: number };
}

export interface RowNote {
  row: number;
  reason: string;
}

export function referrerWarning(value: string, problem: "none" | "several"): string {
  const what = problem === "none" ? "matches no contact" : "matches several contacts";
  return `Referred by "${value.slice(0, 100)}" ${what}; left out`;
}

/** `row` is the 1-based line in the file (the header is row 1). */
export type PlannedRow =
  | { row: number; draft: ImportDraft; warnings: string[] }
  | { row: number; skip: string; warnings: string[] };

export function parseStatus(value: string): ContactStatus {
  const v = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return v === "client" || v === "past_client" ? v : "lead";
}

export function splitTags(value: string): string[] {
  const names = value
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return names.filter((n, i) => names.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i);
}

/** "Work Phone" -> "Work"; "Phone" / "Telephone Number" / "Phone 2" / "Phone 1 - Value" -> "Phone". */
export function phoneLabel(header: string): string {
  const words = header
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(phone|telephone|tel|number|no\.?|#|value|\d+)$/i.test(w));
  const label = words.join(" ");
  if (!label) return LEGACY_PHONE_LABEL;
  return (label.charAt(0).toUpperCase() + label.slice(1)).slice(0, PHONE_LABEL_MAX);
}

function isRealDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const SLASH_DATE = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/;

/**
 * YYYY-MM-DD, YYYY/MM/DD, an ISO timestamp, or a slash date: M/D/YYYY (US, as Zoho and HubSpot
 * export) unless `dayFirst`, then D/M/YYYY.
 */
export function parseImportDate(value: string, dayFirst = false): string | null {
  const v = value.trim();
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(v);
  const slash = SLASH_DATE.exec(v);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (slash && dayFirst) [y, m, d] = [Number(slash[3]), Number(slash[2]), Number(slash[1])];
  else if (slash) [y, m, d] = [Number(slash[3]), Number(slash[1]), Number(slash[2])];
  else return null;
  if (!isRealDate(y, m, d)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A trimmed cell, minus the ' our export puts before = + - @ so spreadsheets don't run it. */
function readCell(value: string | undefined): string {
  const v = (value ?? "").trim();
  return /^'[=+\-@]/.test(v) ? v.slice(1) : v;
}

/** A slash-date column is day-first when one of its dates can only be read that way (25/12/2026). */
function isDayFirstColumn(values: string[]): boolean {
  return values.some((v) => {
    const m = SLASH_DATE.exec(v.trim());
    return m !== null && Number(m[1]) > 12 && Number(m[2]) <= 12;
  });
}

/**
 * "$1,500,000", "1500000.00", "€ 2 500", "€2.500" or "1.500,75" -> a whole number; null when
 * unusable. With both separators the last one is the decimal point; a single kind before groups
 * of three digits is a thousands separator; otherwise it is the decimal point.
 */
export function parseWholeNumber(value: string): number | null {
  let s = value.trim().replace(/[\s$€£¥]/g, "");
  if (s.includes(".") && s.includes(",")) {
    const decimal = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    s = s.split(decimal === "," ? "." : ",").join("").replace(",", ".");
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(s)) {
    s = s.replace(/[.,]/g, "");
  } else {
    s = s.replace(",", ".");
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s));
  return n <= COMPANY_NUMBER_MAX ? n : null;
}

/** "Mobile: +1 555; Work: +1 777" (our export's All phones), or null for a plain number. */
function labelledPhones(value: string): ContactPhone[] | null {
  const parts = value.split(";").map((p) => p.trim()).filter(Boolean);
  const out: ContactPhone[] = [];
  for (const part of parts) {
    const m = /^([^:\d+()]{1,30}):\s*(.+)$/.exec(part);
    if (!m) return null;
    out.push({ label: m[1].trim(), number: m[2].trim().slice(0, PHONE_NUMBER_MAX) });
  }
  return out.length ? out : null;
}

/**
 * Turns CSV rows into what the import will create, with no I/O. Fields mapped from several
 * columns: phones and social links read all of them; anything else uses the first.
 */
export function planImport(headers: string[], rows: string[][], mapping: ImportMapping): PlannedRow[] {
  const columns = new Map<ImportField, number>();
  const linkColumns: { header: string; index: number }[] = [];
  const phoneColumns: { header: string; index: number }[] = [];
  headers.forEach((h, i) => {
    if (!Object.hasOwn(mapping, h)) return;
    const field = mapping[h];
    if (field === "socialLinks") linkColumns.push({ header: h, index: i });
    else if (field === "phone") phoneColumns.push({ header: h, index: i });
    else if (field !== "skip" && !columns.has(field)) columns.set(field, i);
  });
  const cell = (row: string[], field: ImportField): string => {
    const i = columns.get(field);
    return i === undefined ? "" : readCell(row[i]);
  };

  const dayFirst = isDayFirstColumn(rows.map((row) => cell(row, "followUpAt")));

  // Repeated emails are not skipped here: only a row that is actually written makes a later
  // one a duplicate, which importCsv / checkImport track as they go.
  return rows.map((row, i): PlannedRow => {
    const rowNumber = i + 2;
    const warnings: string[] = [];
    const name = cell(row, "name");
    const firstName = cell(row, "firstName");
    if (!name && !firstName) return { row: rowNumber, skip: "Missing name", warnings };
    const rating = parseRating(cell(row, "rating"));
    if (rating === null) return { row: rowNumber, skip: "Invalid rating", warnings };
    const rawEmail = cell(row, "email");
    if (rawEmail && !isEmail(rawEmail)) return { row: rowNumber, skip: "Invalid email", warnings };
    const email = rawEmail ? normalizeEmail(rawEmail) : undefined;

    // A link never costs the row: unusable ones are dropped with a warning.
    const { links: socialLinks, dropped } = importSocialLinks(
      linkColumns.map((c) => ({ header: c.header, value: readCell(row[c.index]) })),
    );
    for (const link of dropped) {
      warnings.push(`Social link "${link.slice(0, 100)}" isn't a web address; left out`);
    }

    // Labelled lists ("Mobile: …; Work: …", as our export writes) go first, so their labels win
    // over a plain Phone column holding the same first number.
    const labelled: ContactPhone[] = [];
    const plain: ContactPhone[] = [];
    for (const c of phoneColumns) {
      const value = readCell(row[c.index]);
      if (!value) continue;
      const list = labelledPhones(value);
      if (list) labelled.push(...list);
      else plain.push({ label: phoneLabel(c.header), number: value.slice(0, PHONE_NUMBER_MAX) });
    }
    const phones: ContactPhone[] = [];
    for (const p of [...labelled, ...plain]) {
      if (!phones.some((q) => q.number === p.number)) phones.push(p);
    }
    if (phones.length > MAX_PHONES) warnings.push(`Only the first ${MAX_PHONES} phone numbers were kept`);

    const rawFollowUp = cell(row, "followUpAt");
    const followUpAt = rawFollowUp ? parseImportDate(rawFollowUp, dayFirst) : null;
    if (rawFollowUp && !followUpAt) warnings.push(`Follow-up date "${rawFollowUp.slice(0, 50)}" isn't a date; left out`);

    const rawRepeat = cell(row, "followUpEveryDays");
    let followUpEveryDays: number | null = null;
    if (rawRepeat && !followUpAt) {
      warnings.push("Follow-up repeat needs a follow-up date; left out");
    } else if (rawRepeat) {
      const days = Number(rawRepeat);
      if (FOLLOW_UP_REPEAT_DAYS.includes(days)) followUpEveryDays = days;
      else {
        warnings.push(
          `Follow-up repeat "${rawRepeat.slice(0, 20)}" isn't one of ${FOLLOW_UP_REPEAT_DAYS.join(", ")} days; left out`,
        );
      }
    }

    const company: ImportDraft["company"] = {};
    const sizes: [ImportField, keyof ImportDraft["company"], string][] = [
      ["companyRevenue", "annualRevenue", "Annual revenue"],
      ["companyEmployees", "employeeCount", "Employees"],
    ];
    for (const [field, key, label] of sizes) {
      const raw = cell(row, field);
      if (!raw) continue;
      const n = parseWholeNumber(raw);
      if (n === null) warnings.push(`${label} "${raw.slice(0, 50)}" isn't a number; left out`);
      else company[key] = n;
    }
    const companyName = cell(row, "company").slice(0, 200);
    const hasSize = sizes.some(([field]) => cell(row, field));
    if (hasSize && !companyName) {
      warnings.push("No company to attach annual revenue and employees to; left out");
      delete company.annualRevenue;
      delete company.employeeCount;
    }

    return {
      row: rowNumber,
      warnings,
      draft: {
        contact: {
          name: name.slice(0, 200) || undefined,
          firstName: firstName.slice(0, NAME_PART_MAX) || undefined,
          lastName: cell(row, "lastName").slice(0, NAME_PART_MAX) || undefined,
          jobTitle: cell(row, "jobTitle").slice(0, 200) || undefined,
          department: cell(row, "department").slice(0, 100) || undefined,
          socialLinks,
          rating,
          email,
          phones: phones.slice(0, MAX_PHONES),
          website: cell(row, "website").slice(0, 500) || undefined,
          address: cell(row, "address").slice(0, 500) || undefined,
          description: cell(row, "description").slice(0, CONTACT_DESCRIPTION_MAX) || undefined,
          status: parseStatus(cell(row, "status")),
          companyName: companyName || undefined,
          leadSourceName: cell(row, "source").slice(0, LEAD_SOURCE_NAME_MAX) || undefined,
        },
        tags: splitTags(cell(row, "tags")),
        notes: cell(row, "notes"),
        referredBy: cell(row, "referredBy").slice(0, 200),
        followUpAt,
        followUpEveryDays,
        company,
      },
    };
  });
}
