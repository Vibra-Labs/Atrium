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

type TabId = "all" | "lead" | "client" | "past_client" | "companies";

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "lead", label: "Leads" },
  { id: "client", label: "Clients" },
  { id: "past_client", label: "Past clients" },
  { id: "companies", label: "Companies" },
];

const LIMIT = 20;

type AccessFilter = "portal" | "pending" | "none";

const ACCESS_FILTERS: Record<AccessFilter, string> = {
  portal: "Has access",
  pending: "Invite pending",
  none: "No access",
};

function isAccessFilter(value: string): value is AccessFilter {
  return Object.hasOwn(ACCESS_FILTERS, value);
}

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
  const [access, setAccess] = useState<AccessFilter | "">("");
  const rowLink = useRowLink();
  const [tab, setTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [labelId, setLabelId] = useState("");
  const [leadSourceId, setLeadSourceId] = useState("");
  const [rating, setRating] = useState("");
  const [page, setPage] = useState(1);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [labels, setLabels] = useState<Option[]>([]);
  const [sources, setSources] = useState<Option[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Deep links: a company page back to the Companies tab; /dashboard/clients to ?access=portal.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "companies") setTab("companies");
    const deepAccess: string = params.get("access") ?? "";
    if (isAccessFilter(deepAccess)) setAccess(deepAccess);
  }, []);

  useEffect(() => {
    if (!config?.billingEnabled) return;
    apiFetch<{ subscription: { plan: { maxClients: number } } | null; usage: { clients: number } }>(
      "/billing/subscription",
    )
      .then(({ subscription, usage }) => {
        const max = subscription?.plan.maxClients;
        if (max !== undefined && max !== -1) setClientLimit({ max, used: usage.clients });
      })
      .catch((err: unknown) => console.error(err));
  }, [config?.billingEnabled]);

  useEffect(() => {
    apiFetch<Option[]>("/labels").then(setLabels).catch(console.error);
    apiFetch<Option[]>("/lead-sources").then(setSources).catch(console.error);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const filterParams = useCallback((): URLSearchParams => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (tab !== "all" && tab !== "companies") params.set("status", tab);
    if (labelId) params.set("labelId", labelId);
    if (leadSourceId) params.set("leadSourceId", leadSourceId);
    if (rating) params.set("rating", rating);
    if (access) params.set("access", access);
    return params;
  }, [debouncedSearch, tab, labelId, leadSourceId, rating, access]);

  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      if (tab === "companies") {
        const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
        if (debouncedSearch) params.set("search", debouncedSearch);
        const res = await apiFetch<Paginated<CompanyRow>>(`/companies?${params}`);
        if (id !== requestId.current) return;
        setCompanies(res.data);
        setTotalPages(res.meta.totalPages);
      } else {
        const params = filterParams();
        params.set("page", String(page));
        params.set("limit", String(LIMIT));
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
  }, [tab, page, debouncedSearch, filterParams, showError]);

  useEffect(() => {
    load();
  }, [load]);

  async function exportCsv(): Promise<void> {
    try {
      const qs = filterParams().toString();
      await downloadCsv(`/contacts/export${qs ? `?${qs}` : ""}`);
    } catch (err) {
      console.error(err);
      showError("Export failed");
    }
  }

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
              if ((t.id === "companies") !== (tab === "companies")) setSearch("");
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
        {tab !== "companies" && (
          <>
            <select
              aria-label="Filter by tag"
              value={labelId}
              onChange={(e) => {
                setLabelId(e.target.value);
                setPage(1);
              }}
              className={selectClass}
            >
              <option value="">All tags</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by source"
              value={leadSourceId}
              onChange={(e) => {
                setLeadSourceId(e.target.value);
                setPage(1);
              }}
              className={selectClass}
            >
              <option value="">All sources</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by rating"
              value={rating}
              onChange={(e) => {
                setRating(e.target.value);
                setPage(1);
              }}
              className={selectClass}
            >
              <option value="">All ratings</option>
              {Object.entries(RATING_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by portal access"
              value={access}
              onChange={(e) => {
                setAccess(isAccessFilter(e.target.value) ? e.target.value : "");
                setPage(1);
              }}
              className={selectClass}
            >
              <option value="">Portal access: all</option>
              {Object.entries(ACCESS_FILTERS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

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
                  <th className="px-4 py-2.5 font-medium">Company</th>
                  <th className="px-4 py-2.5 font-medium">People</th>
                  <th className="px-4 py-2.5 font-medium text-right">Paid, all time</th>
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
          {debouncedSearch || labelId || leadSourceId || rating || access || tab !== "all"
            ? "No contacts match these filters."
            : "No contacts yet. Add one or import a CSV."}
        </p>
      ) : (
        <div className="border border-[var(--border)] rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--muted-foreground)] border-b border-[var(--border)]">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Next follow-up</th>
                <th className="px-4 py-2.5 font-medium text-right">Paid, all time</th>
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
