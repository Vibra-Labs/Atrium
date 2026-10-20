"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, Plus, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { downloadCsv } from "@/lib/download";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/components/toast";
import { LabelBadge } from "@/components/label-badge";
import { Pagination } from "@/components/pagination";
import { ClientItemSkeleton } from "@/components/skeletons";
import { AddContactModal } from "./add-contact-modal";
import { ImportContactsModal } from "./import-contacts-modal";

interface ContactRow {
  id: string;
  name: string;
  email: string | null;
  status: string;
  company: { id: string; name: string } | null;
  followUpAt: string | null;
  followUpEveryDays: number | null;
  paidCents: number;
  labels: { id: string; name: string; color: string }[];
  hasLogin: boolean;
}

interface CompanyRow {
  id: string;
  name: string;
  _count: { contacts: number };
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

const STATUS_LABELS: Record<string, string> = {
  lead: "Lead",
  client: "Client",
  past_client: "Past client",
};

const REPEAT_LABELS: Record<number, string> = {
  14: "2 wk",
  30: "1 mo",
  90: "3 mo",
  180: "6 mo",
  365: "1 yr",
};

const LIMIT = 20;

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function FollowUp({ at, everyDays }: { at: string | null; everyDays: number | null }) {
  if (!at) return <span className="text-[var(--muted-foreground)]">—</span>;
  const day = formatDay(at);
  if (new Date(at).getTime() < Date.now()) {
    return <span className="text-red-600">Overdue · {day}</span>;
  }
  if (everyDays) {
    const every = REPEAT_LABELS[everyDays] ?? `${everyDays} d`;
    return <span>Every {every} · {day}</span>;
  }
  return <span>{day}</span>;
}

export default function ContactsPage() {
  const { error: showError } = useToast();
  const [tab, setTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [labelId, setLabelId] = useState("");
  const [leadSourceId, setLeadSourceId] = useState("");
  const [page, setPage] = useState(1);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [labels, setLabels] = useState<Option[]>([]);
  const [sources, setSources] = useState<Option[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

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
    return params;
  }, [debouncedSearch, tab, labelId, leadSourceId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "companies") {
        const res = await apiFetch<Paginated<CompanyRow>>(`/companies?page=${page}&limit=${LIMIT}`);
        setCompanies(res.data);
        setTotalPages(res.meta.totalPages);
      } else {
        const params = filterParams();
        params.set("page", String(page));
        params.set("limit", String(LIMIT));
        const res = await apiFetch<Paginated<ContactRow>>(`/contacts?${params}`);
        setContacts(res.data);
        setTotalPages(res.meta.totalPages);
      }
    } catch (err) {
      console.error(err);
      showError("Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [tab, page, filterParams, showError]);

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
        <h1 className="text-2xl font-bold">Contacts</h1>
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

      <div className="flex gap-1 border-b border-[var(--border)] overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
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

      {tab !== "companies" && (
        <div className="flex gap-2 flex-wrap">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search name, company, email"
            className={`${selectClass} flex-1 min-w-[12rem]`}
          />
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
        </div>
      )}

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
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/dashboard/contacts/companies/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{c._count.contacts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : contacts.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">
          {debouncedSearch || labelId || leadSourceId || tab !== "all"
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
                <tr key={c.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]">
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
                    {c.hasLogin && (
                      <span className="ml-1 text-xs text-[var(--muted-foreground)]">(portal)</span>
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
