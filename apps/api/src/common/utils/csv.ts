export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

function escapeField(val: string): string {
  if (val.includes('"') || val.includes(",") || val.includes("\n") || val.includes("\r")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
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
