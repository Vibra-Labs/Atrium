export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

// Neutralize CSV formula-injection: spreadsheet apps evaluate cells starting
// with = @ + - (and tab/CR) as formulas. Prefixing with a single quote renders
// them as literal text without changing the visible value meaningfully.
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

function escapeField(val: string): string {
  const escaped = FORMULA_PREFIXES.includes(val.charAt(0)) ? `'${val}` : val;
  if (
    escaped.includes('"') ||
    escaped.includes(",") ||
    escaped.includes("\n") ||
    escaped.includes("\r")
  ) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = columns.map((c) => escapeField(c.header)).join(",");
  const lines = rows.map((row) =>
    columns
      .map((col) => {
        const raw = col.value(row);
        if (raw == null) return "";
        return escapeField(String(raw));
      })
      .join(","),
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}
