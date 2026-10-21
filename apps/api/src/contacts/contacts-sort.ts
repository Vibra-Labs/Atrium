import { Prisma } from "@atrium/database";
import { CONTACT_STATUSES } from "@atrium/shared";
import type { ContactSort, SortDirection } from "./contacts.dto";

/** The fields a contacts list can be ordered by. */
export interface SortableContact {
  id: string;
  name: string;
  status: string;
  companyName: string | null;
  followUpAt: Date | null;
}

type SortValue = number | string | null;

/** Ids ordered by `value`; empty values always last, ties by name, then id (stable pages). */
export function rankRows<T extends { id: string; name: string }>(
  rows: T[],
  dir: SortDirection,
  value: (row: T) => SortValue,
): string[] {
  const sign = dir === "asc" ? 1 : -1;
  const keyed = rows.map((row) => ({ row, key: value(row) }));
  keyed.sort((a, b) => {
    if (a.key !== b.key) {
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      const diff =
        typeof a.key === "number" && typeof b.key === "number"
          ? a.key - b.key
          : String(a.key).localeCompare(String(b.key), undefined, { sensitivity: "base" });
      if (diff !== 0) return sign * diff;
    }
    return a.row.name.localeCompare(b.row.name) || a.row.id.localeCompare(b.row.id);
  });
  return keyed.map((k) => k.row.id);
}

/** What a contact is ordered by for each list column; status follows the pipeline. */
export function contactSortValue(sort: ContactSort, row: SortableContact, paid: Map<string, number>): SortValue {
  switch (sort) {
    case "name":
      return row.name;
    case "company":
      return row.companyName;
    case "status": {
      const i = (CONTACT_STATUSES as readonly string[]).indexOf(row.status);
      return i === -1 ? null : i;
    }
    case "followUp":
      return row.followUpAt ? row.followUpAt.getTime() : null;
    case "paid":
      return paid.get(row.id) ?? 0;
  }
}

/**
 * SQL ORDER BY matching `rankRows`: empty (NULL) keys last in both directions, ties by name,
 * then id. The ICU root collation sorts like `localeCompare`; `table` is the row's alias.
 */
export function rankOrderSql(key: Prisma.Sql, dir: SortDirection, table: "c" | "co"): Prisma.Sql {
  const t = Prisma.raw(table);
  const direction = Prisma.raw(dir === "desc" ? "DESC" : "ASC");
  return Prisma.sql`ORDER BY (${key}) IS NULL, ${key} ${direction},
    ${t}.name COLLATE "und-x-icu", ${t}.id COLLATE "und-x-icu"`;
}
