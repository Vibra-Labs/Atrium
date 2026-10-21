import { isEmail } from "class-validator";
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
  /** Filled in on the contact's company only where it has no value yet. */
  company: { annualRevenue?: number; employeeCount?: number };
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

/** "Work Phone" -> "Work"; a plain "Phone" / "Telephone Number" header -> "Phone". */
export function phoneLabel(header: string): string {
  const words = header
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(phone|telephone|tel|number|no\.?|#)$/i.test(w));
  const label = words.join(" ");
  if (!label) return LEGACY_PHONE_LABEL;
  return (label.charAt(0).toUpperCase() + label.slice(1)).slice(0, PHONE_LABEL_MAX);
}

function isRealDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** YYYY-MM-DD, YYYY/MM/DD, M/D/YYYY (US, as Zoho and HubSpot export) or an ISO timestamp. */
export function parseImportDate(value: string): string | null {
  const v = value.trim();
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(v);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [y, m, d] = [Number(us[3]), Number(us[1]), Number(us[2])];
  else return null;
  if (!isRealDate(y, m, d)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "$1,500,000" / "1500000.00" / "€ 2 500" -> a whole number; null when unusable. */
export function parseWholeNumber(value: string): number | null {
  const cleaned = value.trim().replace(/[\s,$€£¥]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Math.round(Number(cleaned));
  return n <= COMPANY_NUMBER_MAX ? n : null;
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
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const seen = new Set<string>();
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
    if (email && seen.has(email)) return { row: rowNumber, skip: "Email already exists", warnings };
    if (email) seen.add(email);

    // A link never costs the row: unusable ones are dropped with a warning.
    const { links: socialLinks, dropped } = importSocialLinks(
      linkColumns.map((c) => ({ header: c.header, value: row[c.index] ?? "" })),
    );
    for (const link of dropped) {
      warnings.push(`Social link "${link.slice(0, 100)}" isn't a web address; left out`);
    }

    const phones: ContactPhone[] = [];
    for (const c of phoneColumns) {
      const number = (row[c.index] ?? "").trim().slice(0, PHONE_NUMBER_MAX);
      if (number && !phones.some((p) => p.number === number)) phones.push({ label: phoneLabel(c.header), number });
    }
    if (phones.length > MAX_PHONES) warnings.push(`Only the first ${MAX_PHONES} phone numbers were kept`);

    const rawFollowUp = cell(row, "followUpAt");
    const followUpAt = rawFollowUp ? parseImportDate(rawFollowUp) : null;
    if (rawFollowUp && !followUpAt) warnings.push(`Follow-up date "${rawFollowUp.slice(0, 50)}" isn't a date; left out`);

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
        company,
      },
    };
  });
}
