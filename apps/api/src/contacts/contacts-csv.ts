export const IMPORT_FIELDS = [
  "name",
  "email",
  "phone",
  "company",
  "website",
  "address",
  "source",
  "tags",
  "status",
  "notes",
  "skip",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const MAX_IMPORT_ROWS = 5000;

export type ImportMapping = Record<string, ImportField>;

/** Parses the `mapping` form field; returns null unless it is a JSON object of header -> valid ImportField. */
export function parseMapping(raw: unknown): ImportMapping | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed);
  const valid = entries.every(
    ([, v]) => typeof v === "string" && (IMPORT_FIELDS as readonly string[]).includes(v),
  );
  return valid ? (Object.fromEntries(entries) as ImportMapping) : null;
}

/** Parses RFC 4180 CSV: BOM, quoted fields with commas/newlines/escaped quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endRow = (): void => {
    row.push(field);
    field = "";
    // Skip fully blank lines.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
