"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { StatCardSkeleton } from "@/components/skeletons";
import { FolderKanban, TrendingUp, CheckCircle, Receipt } from "lucide-react";
import { WeeklyUpdatesCard } from "./weekly-updates-card";

interface Project {
  id: string;
  name: string;
  status: string;
  createdAt: string;
}

interface Stats {
  total: number;
  inProgress: number;
  completed: number;
}

interface InvoiceStats {
  outstandingAmount: number;
  totalInvoices: number;
  paidAmount: number;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [invoiceStats, setInvoiceStats] = useState<InvoiceStats | null>(null);
  const [recent, setRecent] = useState<Project[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<Stats>("/projects/stats")
      .then(setStats)
      .catch((err) => setError(err.message || "Failed to load stats"));
    apiFetch<PaginatedResponse<Project>>("/projects?limit=5")
      .then((res) => setRecent(res.data))
      .catch(console.error);
    apiFetch<InvoiceStats>("/invoices/stats")
      .then(setInvoiceStats)
      .catch(console.error);
  }, []);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {error && (
        <div className="p-4 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats === null ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <div className="p-4 border border-[var(--border)] rounded-lg">
              <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <FolderKanban size={16} />
                Total Projects
              </div>
              <p className="text-3xl font-bold mt-1">{stats.total}</p>
            </div>
            <div className="p-4 border border-[var(--border)] rounded-lg">
              <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <TrendingUp size={16} />
                In Progress
              </div>
              <p className="text-3xl font-bold mt-1">{stats.inProgress}</p>
            </div>
            <div className="p-4 border border-[var(--border)] rounded-lg">
              <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <CheckCircle size={16} />
                Completed
              </div>
              <p className="text-3xl font-bold mt-1">{stats.completed}</p>
            </div>
            <div className="p-4 border border-[var(--border)] rounded-lg">
              <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <Receipt size={16} />
                Outstanding
              </div>
              <p className="text-3xl font-bold mt-1">
                {invoiceStats ? formatCurrency(invoiceStats.outstandingAmount) : "$0.00"}
              </p>
            </div>
          </>
        )}
      </div>

      <WeeklyUpdatesCard />

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent Projects</h2>
          <Link
            href="/dashboard/projects"
            className="text-sm text-[var(--primary)] hover:underline"
          >
            View all
          </Link>
        </div>
        {recent.length > 0 ? (
          <div className="space-y-2">
            {recent.map((project) => (
              <Link
                key={project.id}
                href={`/dashboard/projects/${project.id}`}
                className="block p-3 border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{project.name}</span>
                  <span className="text-xs px-2 py-1 bg-[var(--muted)] rounded-full">
                    {project.status.replace(/_/g, " ")}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : stats !== null ? (
          <p className="text-[var(--muted-foreground)] text-sm">
            No projects yet.{" "}
            <Link
              href="/dashboard/projects"
              className="text-[var(--primary)] hover:underline"
            >
              Create your first project
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
