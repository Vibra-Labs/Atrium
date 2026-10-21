import { RATING_LABELS } from "./shared";
import type { SortDir, SortOption } from "./list-controls";

export type TabId = "all" | "lead" | "client" | "past_client" | "companies";

export const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "lead", label: "Leads" },
  { id: "client", label: "Clients" },
  { id: "past_client", label: "Past clients" },
  { id: "companies", label: "Companies" },
];

export type AccessFilter = "portal" | "pending" | "none";

export const ACCESS_FILTERS: Record<AccessFilter, string> = {
  portal: "Has access",
  pending: "Invite pending",
  none: "No access",
};

export const CONTACT_SORTS: SortOption[] = [
  { value: "name", label: "Name", defaultDir: "asc" },
  { value: "company", label: "Company", defaultDir: "asc" },
  { value: "status", label: "Status", defaultDir: "asc" },
  { value: "followUp", label: "Next follow-up", defaultDir: "asc" },
  { value: "paid", label: "Paid, all time", defaultDir: "desc" },
];

export const COMPANY_SORTS: SortOption[] = [
  { value: "name", label: "Company", defaultDir: "asc" },
  { value: "people", label: "People", defaultDir: "desc" },
  { value: "paid", label: "Paid, all time", defaultDir: "desc" },
];

export const sortsFor = (tab: TabId): SortOption[] => (tab === "companies" ? COMPANY_SORTS : CONTACT_SORTS);

// A type (not an interface) so it can be passed where a Record<string, string> is expected.
export type Filters = {
  labelId: string;
  leadSourceId: string;
  rating: string;
  access: string;
};

export const NO_FILTERS: Filters = { labelId: "", leadSourceId: "", rating: "", access: "" };

/** Everything that shapes the Contacts list, kept in the address so Back returns to the same view. */
export interface ListState {
  tab: TabId;
  search: string;
  page: number;
  sort: string;
  dir: SortDir;
  filters: Filters;
}

export const DEFAULT_LIST_STATE: ListState = {
  tab: "all",
  search: "",
  page: 1,
  sort: "name",
  dir: "asc",
  filters: NO_FILTERS,
};

/** Reads a `location.search`; anything unknown or out of place falls back to the default. */
export function readListState(search: string): ListState {
  const p = new URLSearchParams(search);
  const tabParam = p.get("tab") ?? "";
  const tab: TabId = TABS.find((t) => t.id === tabParam)?.id ?? "all";
  const sortOption = sortsFor(tab).find((o) => o.value === p.get("sort")) ?? sortsFor(tab)[0];
  const dirParam = p.get("dir");
  const pageParam = Number(p.get("page"));
  const access = p.get("access") ?? "";
  const rating = p.get("rating") ?? "";
  return {
    tab,
    search: p.get("q") ?? "",
    page: Number.isInteger(pageParam) && pageParam > 1 ? pageParam : 1,
    sort: sortOption.value,
    dir: dirParam === "asc" || dirParam === "desc" ? dirParam : sortOption.defaultDir,
    filters: {
      labelId: p.get("labelId") ?? "",
      leadSourceId: p.get("leadSourceId") ?? "",
      rating: Object.hasOwn(RATING_LABELS, rating) ? rating : "",
      access: Object.hasOwn(ACCESS_FILTERS, access) ? access : "",
    },
  };
}

/** The query string for a list state, without the defaults (so a plain list has a clean address). */
export function listQuery(state: ListState): string {
  const p = new URLSearchParams();
  if (state.tab !== "all") p.set("tab", state.tab);
  if (state.search) p.set("q", state.search);
  if (state.page > 1) p.set("page", String(state.page));
  const defaultSort = sortsFor(state.tab)[0];
  const sortOption = sortsFor(state.tab).find((o) => o.value === state.sort) ?? defaultSort;
  if (sortOption.value !== defaultSort.value || state.dir !== sortOption.defaultDir) {
    p.set("sort", sortOption.value);
    p.set("dir", state.dir);
  }
  for (const [key, value] of Object.entries(state.filters)) if (value) p.set(key, value);
  return p.toString();
}
