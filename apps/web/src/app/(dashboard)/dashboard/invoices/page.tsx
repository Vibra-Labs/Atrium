"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import { Receipt, Download, TrendingUp, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { downloadCsv } from "@/lib/download";
import Link from "next/link";

interface Project {
  id: string;
  name: string;
}

interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  status: string;
  type: string;
  amount?: number | null;
  dueDate?: string | null;
  notes?: string | null;
  lineItems: { quantity: number; unitPrice: number }[];
  createdAt: string;
  paidAt?: string | null;
  stripePaymentIntentId?: string | null;
  project?: { id: string; name: string } | null;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface Stats {
  totalInvoices: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
}

const statusColors: Record<string, { bg: string; text: string }> = {
  draft: { bg: "#e5e7eb", text: "#374151" },
  sent: { bg: "#dbeafe", text: "#1d4ed8" },
  paid: { bg: "#dcfce7", text: "#15803d" },
  overdue: { bg: "#fee2e2", text: "#b91c1c" },
  cancelled: { bg: "#f3f4f6", text: "#6b7280" },
};

export default function InvoicesPage() {
  const { error: showError } = useToast();

  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "20");
      if (statusFilter) params.set("status", statusFilter);
      if (projectFilter) params.set("projectId", projectFilter);

      const [res, statsRes] = await Promise.all([
        apiFetch<PaginatedResponse<InvoiceListItem>>(`/invoices?${params.toString()}`),
        apiFetch<Stats>("/invoices/stats"),
      ]);

      setInvoices(res.data);
      setTotalPages(res.meta.totalPages);
      setStats(statsRes);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, projectFilter, showError]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    apiFetch<{ data: Project[] }>("/projects?limit=200")
      .then((res) => setProjects(res.data))
      .catch(console.error);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, projectFilter]);

  const statCards = stats
    ? [
        {
          label: "Outstanding",
          value: formatCurrency(stats.outstandingAmount),
          icon: Clock,
          color: "text-blue-600",
          bg: "bg-blue-50",
        },
        {
          label: "Collected",
          value: formatCurrency(stats.paidAmount),
          icon: CheckCircle2,
          color: "text-green-600",
          bg: "bg-green-50",
        },
        {
          label: "Total Invoiced",
          value: formatCurrency(stats.totalAmount),
          icon: TrendingUp,
          color: "text-[var(--primary)]",
          bg: "bg-[var(--muted)]",
        },
        {
          label: "Total Invoices",
          value: String(stats.totalInvoices),
          icon: AlertCircle,
          color: "text-[var(--muted-foreground)]",
          bg: "bg-[var(--muted)]",
        },
      ]
    : [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Receipt size={20} />
            Invoices
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
            All invoices across your projects
          </p>
        </div>
        <button
          onClick={() => downloadCsv("/invoices/export")}
          className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <Download size={14} />
          Export CSV
        </button>
      </div>

      {/* Stat cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {statCards.map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="border border-[var(--border)] rounded-xl p-4 space-y-2">
              <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
                <Icon size={16} className={color} />
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
              <p className="text-lg font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
        >
          <option value="">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Invoice table */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 bg-[var(--muted)] rounded-lg animate-pulse" />
          ))}
        </div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-16">
          <Receipt size={36} className="mx-auto text-[var(--muted-foreground)] mb-3" />
          <p className="text-sm text-[var(--muted-foreground)]">No invoices found.</p>
        </div>
      ) : (
        <div className="border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                  <th className="text-left px-4 py-2.5 font-medium">Invoice</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">Project</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Due</th>
                  <th className="text-right px-4 py-2.5 font-medium">Amount</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const total =
                    inv.type === "uploaded"
                      ? inv.amount || 0
                      : inv.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
                  const colors = statusColors[inv.status] || statusColors.draft;

                  return (
                    <tr
                      key={inv.id}
                      className="border-t border-[var(--border)] hover:bg-[var(--muted)] transition-colors"
                    >
                      <td className="px-4 py-3 font-medium">{inv.invoiceNumber}</td>
                      <td className="px-4 py-3 hidden sm:table-cell text-[var(--muted-foreground)]">
                        {inv.project ? (
                          <Link
                            href={`/dashboard/projects/${inv.project.id}`}
                            className="hover:text-[var(--foreground)] hover:underline transition-colors"
                          >
                            {inv.project.name}
                          </Link>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-[var(--muted-foreground)]">
                        {inv.dueDate
                          ? new Date(inv.dueDate).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(total)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-xs px-2 py-1 rounded-full font-medium capitalize"
                          style={{ backgroundColor: colors.bg, color: colors.text }}
                        >
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
