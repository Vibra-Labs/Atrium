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
};

/** Guesses the field for a CSV header (Zoho / HubSpot style exports included). */
export function autoMatch(header: string): ImportField {
  const key = header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (ALIASES[key]) return ALIASES[key];
  const field = IMPORT_FIELDS.find((f) => f.value !== "skip" && f.value.toLowerCase() === key);
  return field ? field.value : "skip";
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
