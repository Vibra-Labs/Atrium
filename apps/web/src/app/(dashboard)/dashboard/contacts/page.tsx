"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, ExternalLink, Plus, Sparkles, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAppConfig } from "@/lib/app-config";
import { downloadCsv } from "@/lib/download";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/components/toast";
import { LabelBadge } from "@/components/label-badge";
import { Pagination } from "@/components/pagination";
import { ClientItemSkeleton } from "@/components/skeletons";
import { AddContactModal } from "./add-contact-modal";
import { ImportContactsModal } from "./import-contacts-modal";
import { followUpWhen, formatFollowUpDay } from "@/lib/follow-up-date";
import { RATING_LABELS, REPEAT_LABELS, STATUS_LABELS } from "./shared";
import { RatingBadge } from "./rating-badge";
import { useRowLink } from "@/lib/use-row-link";
import { FilterChips, FilterMenu, SortHeader, SortMenu, nextSort } from "./list-controls";
import type { FilterGroup, SortDir, SortOption } from "./list-controls";
import {
  ACCESS_FILTERS,
  COMPANY_SORTS,
  CONTACT_SORTS,
  TABS,
  listQuery,
  readListState,
  sortsFor,
} from "./list-state";
import type { Filters, ListState, TabId } from "./list-state";
import { useSearchParams } from "next/navigation";
import { loadSubscription, useCachedApi } from "@/lib/cached";

interface ContactRow {
  id: string;
  name: string;
  email: string | null;
  status: string;
  rating: string | null;
  company: { id: string; name: string } | null;
  followUpAt: string | null;
  followUpEveryDays: number | null;
  paidCents: number;
  labels: { id: string; name: string; color: string }[];
  hasLogin: boolean;
  portalAccess: "portal" | "pending" | null;
}

interface CompanyRow {
  id: string;
  name: string;
  _count: { contacts: number };
  paidCents: number;
}

interface Option {
  id: string;
  name: string;
}

interface Paginated<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const LIMIT = 20;

interface ClientLimit {
  max: number;
  used: number;
}

/** Portal clients used / allowed on the plan (pending invites hold a seat), when billing applies. */
function ClientLimitNotice({ limit }: { limit: ClientLimit }): React.ReactElement {
  if (limit.used < limit.max) {
    return (
      <span
        data-testid="client-limit"
        className="text-xs px-2 py-0.5 rounded-full font-medium bg-[var(--muted)] text-[var(--muted-foreground)]"
      >
        {limit.used}/{limit.max} portal clients
      </span>
    );
  }
  return (
    <div
      data-testid="client-limit"
      className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--muted)] px-4 py-3"
    >
      <Sparkles size={15} className="text-amber-500 shrink-0" aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">Client limit reached</p>
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
          {limit.used}/{limit.max} portal clients. Upgrade to Pro for unlimited clients. Contacts stay unlimited.
        </p>
      </div>
      <Link
        href="/dashboard/settings/billing?reason=clients"
        className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90 whitespace-nowrap"
      >
        Upgrade
        <ExternalLink size={11} aria-hidden />
      </Link>
    </div>
  );
}

function FollowUp({ at, everyDays }: { at: string | null; everyDays: number | null }) {
  if (!at) return <span className="text-[var(--muted-foreground)]">—</span>;
  const day = formatFollowUpDay(at);
  const when = followUpWhen(at);
  if (when === "overdue") {
    return <span className="text-red-600">Overdue · {day}</span>;
  }
  if (when === "today") {
    return <span>Today</span>;
  }
  if (everyDays) {
    const every = REPEAT_LABELS[everyDays] ?? `${everyDays} d`;
    return <span>Every {every} · {day}</span>;
  }
  return <span>{day}</span>;
}

export default function ContactsPage() {
  const { error: showError } = useToast();
  const config = useAppConfig();
  const [clientLimit, setClientLimit] = useState<ClientLimit | null>(null);
  const rowLink = useRowLink();
  // Sort, filters, search, tab and page live in the address: Back from a contact (and deep links
  // such as /dashboard/clients -> ?access=portal, or a company page -> ?tab=companies) restore them.
  // Read while rendering, so nothing typed before the page finishes loading gets overwritten.
  const searchParams = useSearchParams();
  const [initial] = useState<ListState>(() => readListState(`?${searchParams.toString()}`));
  const [tab, setTab] = useState<TabId>(initial.tab);
  const [search, setSearch] = useState<string>(initial.search);
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initial.search.trim());
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [order, setOrder] = useState<{ sort: string; dir: SortDir }>({ sort: initial.sort, dir: initial.dir });
  const [page, setPage] = useState<number>(initial.page);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const labels: Option[] | null = useCachedApi<Option[]>("/labels");
  const sources: Option[] | null = useCachedApi<Option[]>("/lead-sources");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    const query = listQuery({ tab, search: debouncedSearch, page, sort: order.sort, dir: order.dir, filters });
    const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
    // Keeping Next's own history state makes this a plain address update: the router doesn't
    // act on it, so a delayed search update can't cancel a click that is opening a contact.
    if (url !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(window.history.state, "", url);
    }
  }, [tab, debouncedSearch, page, order, filters]);

  useEffect(() => {
    if (!config?.billingEnabled) return;
    loadSubscription().then((res) => {
      const max = res?.subscription?.plan?.maxClients;
      if (res && max !== undefined && max !== -1) setClientLimit({ max, used: res.usage.clients });
    });
  }, [config?.billingEnabled]);

  // A tag or source filter from an old link may point at one that was deleted since: drop it
  // rather than show a chip with a raw id.
  useEffect(() => {
    if (labels && filters.labelId && !labels.some((l) => l.id === filters.labelId)) {
      setFilters((f) => ({ ...f, labelId: "" }));
    }
    if (sources && filters.leadSourceId && !sources.some((s) => s.id === filters.leadSourceId)) {
      setFilters((f) => ({ ...f, leadSourceId: "" }));
    }
  }, [labels, sources, filters.labelId, filters.leadSourceId]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const filterParams = useCallback((): URLSearchParams => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (tab !== "all" && tab !== "companies") params.set("status", tab);
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    return params;
  }, [debouncedSearch, tab, filters]);

  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      if (tab === "companies") {
        const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
        if (debouncedSearch) params.set("search", debouncedSearch);
        params.set("sort", order.sort);
        params.set("dir", order.dir);
        const res = await apiFetch<Paginated<CompanyRow>>(`/companies?${params}`);
        if (id !== requestId.current) return;
        setCompanies(res.data);
        setTotalPages(res.meta.totalPages);
      } else {
        const params = filterParams();
        params.set("page", String(page));
        params.set("limit", String(LIMIT));
        params.set("sort", order.sort);
        params.set("dir", order.dir);
        const res = await apiFetch<Paginated<ContactRow>>(`/contacts?${params}`);
        if (id !== requestId.current) return;
        setContacts(res.data);
        setTotalPages(res.meta.totalPages);
      }
    } catch (err) {
      console.error(err);
      if (id === requestId.current) showError("Failed to load contacts");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [tab, page, debouncedSearch, filterParams, order, showError]);

  useEffect(() => {
    load();
  }, [load]);

  async function exportCsv(): Promise<void> {
    try {
      // Same rows, in the same order, as the list on screen.
      const params = filterParams();
      params.set("sort", order.sort);
      params.set("dir", order.dir);
      await downloadCsv(`/contacts/export?${params}`);
    } catch (err) {
      console.error(err);
      showError("Export failed");
    }
  }

  const sortOptions: SortOption[] = sortsFor(tab);

  function sortBy(option: SortOption): void {
    setOrder((o) => nextSort(o, option));
    setPage(1);
  }

  function setFilter(key: string, value: string): void {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  const filterGroups: FilterGroup[] = [
    { key: "labelId", label: "Tag", options: (labels ?? []).map((l) => ({ value: l.id, label: l.name })) },
    { key: "leadSourceId", label: "Source", options: (sources ?? []).map((s) => ({ value: s.id, label: s.name })) },
    {
      key: "rating",
      label: "Rating",
      options: Object.entries(RATING_LABELS).map(([value, label]) => ({ value, label })),
    },
    {
      key: "access",
      label: "Portal access",
      options: Object.entries(ACCESS_FILTERS).map(([value, label]) => ({ value, label })),
    },
  ];
  const anyFilter: boolean = Object.values(filters).some(Boolean);

  const selectClass =
    "px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold">Contacts</h1>
          {clientLimit && clientLimit.used < clientLimit.max && <ClientLimitNotice limit={clientLimit} />}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            title="Export CSV"
            className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] rounded-lg text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <Download size={14} /> Export
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] rounded-lg text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <Upload size={14} /> Import
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 transition-colors"
          >
            <Plus size={14} /> Add contact
          </button>
        </div>
      </div>

      {clientLimit && clientLimit.used >= clientLimit.max && <ClientLimitNotice limit={clientLimit} />}

      <div className="flex gap-1 border-b border-[var(--border)] overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              // Contact and company searches mean different things; don't carry one over.
              if ((t.id === "companies") !== (tab === "companies")) {
                setSearch("");
                // Companies and contacts sort by different columns.
                setOrder({ sort: "name", dir: "asc" });
              }
              setTab(t.id);
              setPage(1);
            }}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-[var(--primary)] font-medium"
                : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={tab === "companies" ? "Search companies" : "Search name, company, email"}
          className={`${selectClass} flex-1 min-w-[12rem]`}
        />
        {/* Kept together and to the right, so their menus have room when the row wraps on a phone. */}
        <div className="flex gap-2 ml-auto">
          {tab !== "companies" && <FilterMenu groups={filterGroups} values={filters} onChange={setFilter} />}
          <SortMenu
            options={sortOptions}
            sort={order.sort}
            dir={order.dir}
            onChange={(sort, dir) => {
              setOrder({ sort, dir });
              setPage(1);
            }}
          />
        </div>
      </div>

      {tab !== "companies" && <FilterChips groups={filterGroups} values={filters} onChange={setFilter} />}

      {loading ? (
        <div className="space-y-2">
          <ClientItemSkeleton />
          <ClientItemSkeleton />
          <ClientItemSkeleton />
        </div>
      ) : tab === "companies" ? (
        companies.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">No companies yet.</p>
        ) : (
          <div className="border border-[var(--border)] rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--muted-foreground)] border-b border-[var(--border)]">
                  {COMPANY_SORTS.map((o) => (
                    <SortHeader
                      key={o.value}
                      option={o}
                      sort={order.sort}
                      dir={order.dir}
                      onSort={sortBy}
                      align={o.value === "paid" ? "right" : "left"}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr
                    key={c.id}
                    data-testid="company-row"
                    {...rowLink(`/dashboard/contacts/companies/${c.id}`)}
                    className="cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
                  >
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/dashboard/contacts/companies/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{c._count.contacts}</td>
                    <td className="px-4 py-3 text-right">
                      {c.paidCents > 0 ? formatCurrency(c.paidCents) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : contacts.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">
          {debouncedSearch || anyFilter || tab !== "all"
            ? "No contacts match these filters."
            : "No contacts yet. Add one or import a CSV."}
        </p>
      ) : (
        <div className="border border-[var(--border)] rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--muted-foreground)] border-b border-[var(--border)]">
                {CONTACT_SORTS.map((o) => (
                  <SortHeader
                    key={o.value}
                    option={o}
                    sort={order.sort}
                    dir={order.dir}
                    onSort={sortBy}
                    align={o.value === "paid" ? "right" : "left"}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr
                  key={c.id}
                  data-testid="contact-row"
                  {...rowLink(`/dashboard/contacts/${c.id}`)}
                  className="cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
                >
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/contacts/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    {c.labels.length > 0 && (
                      <span className="ml-2 inline-flex gap-1 flex-wrap">
                        {c.labels.map((l) => (
                          <LabelBadge key={l.id} name={l.name} color={l.color} />
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{c.company?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    {STATUS_LABELS[c.status] ?? c.status}
                    {c.portalAccess && (
                      <span
                        data-testid="portal-badge"
                        className={`ml-2 inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                          c.portalAccess === "portal"
                            ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                            : "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                        }`}
                      >
                        {c.portalAccess === "portal" ? "Portal" : "Invite pending"}
                      </span>
                    )}
                    {c.rating && (
                      <span className="ml-2">
                        <RatingBadge rating={c.rating} />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <FollowUp at={c.followUpAt} everyDays={c.followUpEveryDays} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.paidCents > 0 ? formatCurrency(c.paidCents) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

      {showAdd && (
        <AddContactModal
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {showImport && (
        <ImportContactsModal onClose={() => setShowImport(false)} onImported={load} />
      )}
    </div>
  );
}
