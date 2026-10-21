export type ImportField =
  | "name"
  | "firstName"
  | "lastName"
  | "jobTitle"
  | "department"
  | "email"
  | "phone"
  | "company"
  | "website"
  | "address"
  | "source"
  | "tags"
  | "status"
  | "rating"
  | "socialLinks"
  | "notes"
  | "description"
  | "referredBy"
  | "followUpAt"
  | "followUpEveryDays"
  | "companyRevenue"
  | "companyEmployees"
  | "skip";

export const IMPORT_FIELDS: { value: ImportField; label: string }[] = [
  { value: "skip", label: "Skip" },
  { value: "name", label: "Name" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "company", label: "Company" },
  { value: "jobTitle", label: "Job title" },
  { value: "department", label: "Department" },
  { value: "website", label: "Website" },
  { value: "address", label: "Address" },
  { value: "source", label: "Source" },
  { value: "tags", label: "Tags" },
  { value: "status", label: "Status" },
  { value: "rating", label: "Rating" },
  { value: "socialLinks", label: "Social links" },
  { value: "notes", label: "Notes" },
  { value: "description", label: "About" },
  { value: "referredBy", label: "Referred by (name or email)" },
  { value: "followUpAt", label: "Next follow-up (date)" },
  { value: "followUpEveryDays", label: "Follow-up repeats (days)" },
  { value: "companyRevenue", label: "Company annual revenue" },
  { value: "companyEmployees", label: "Company employees" },
];

const ALIASES: Record<string, ImportField> = {
  "company name": "company",
  "e mail": "email",
  "lead source": "source",
  labels: "tags",
  "first name": "firstName",
  firstname: "firstName",
  "last name": "lastName",
  lastname: "lastName",
  surname: "lastName",
  title: "jobTitle",
  "job title": "jobTitle",
  linkedin: "socialLinks",
  twitter: "socialLinks",
  social: "socialLinks",
  "social links": "socialLinks",
  mobile: "phone",
  "mobile phone": "phone",
  "work phone": "phone",
  "home phone": "phone",
  "other phone": "phone",
  "phone number": "phone",
  telephone: "phone",
  cell: "phone",
  "cell phone": "phone",
  about: "description",
  bio: "description",
  "referred by": "referredBy",
  referrer: "referredBy",
  "follow up": "followUpAt",
  "next follow up": "followUpAt",
  "follow up date": "followUpAt",
  "annual revenue": "companyRevenue",
  revenue: "companyRevenue",
  employees: "companyEmployees",
  "no. of employees": "companyEmployees",
  "no of employees": "companyEmployees",
  "number of employees": "companyEmployees",
  "employee count": "companyEmployees",
  "all phones": "phone",
  "follow up repeat": "followUpEveryDays",
  "follow up repeats (days)": "followUpEveryDays",
};

const normalizeHeader = (h: string): string =>
  h.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

/**
 * Guesses the field for a CSV header: Zoho / HubSpot / Outlook / Google exports and our own
 * Contacts export. Unknown headers are skipped.
 */
export function autoMatch(header: string): ImportField {
  const key = normalizeHeader(header);
  if (ALIASES[key]) return ALIASES[key];
  const field = IMPORT_FIELDS.find(
    (f) => f.value !== "skip" && (f.value.toLowerCase() === key || normalizeHeader(f.label) === key),
  );
  if (field) return field.value;
  // "Business Phone", "Home Phone 2", "Phone 1 - Value", "Fax" — but not a phone's type or label column.
  if (/\b(phone|mobile|cell|fax)\b/.test(key) && !/\b(type|label|ext|extension)\b/.test(key)) return "phone";
  return "skip";
}

export type SocialSite = "linkedin" | "instagram" | "x" | "facebook" | "tiktok" | "youtube" | "other";

const SITES: [string[], SocialSite][] = [
  [["linkedin.com"], "linkedin"],
  [["instagram.com"], "instagram"],
  [["x.com", "twitter.com"], "x"],
  [["facebook.com"], "facebook"],
  [["tiktok.com"], "tiktok"],
  [["youtube.com", "youtu.be"], "youtube"],
];

/** Which site a social link points at, by domain (subdomains included), plus its bare host. */
export function socialSite(url: string): { site: SocialSite; host: string } {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { site: "other", host: url };
  }
  const match = SITES.find(([domains]) => domains.some((d) => host === d || host.endsWith(`.${d}`)));
  return { site: match ? match[1] : "other", host };
}

/** Client-side fallback for a contact whose first/last name hasn't been backfilled yet. */
export function splitFullName(name: string): { firstName: string; lastName: string } {
  const [first = "", ...rest] = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: first, lastName: rest.join(" ") };
}

export function telHref(number: string): string {
  return `tel:${number.replace(/[^\d+]/g, "")}`;
}
