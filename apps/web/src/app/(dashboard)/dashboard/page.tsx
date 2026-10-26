"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Eye,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useCurrency } from "@/lib/app-config";
import { useSession } from "@/lib/session-context";
import { formatRelativeTime } from "@/lib/utils";
import { StatCardSkeleton } from "@/components/skeletons";

interface ProjectClient {
  userId: string;
  user?: {
    id: string;
    name: string | null;
    email: string;
  };
}

interface Project {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  startDate?: string | null;
  endDate?: string | null;
  clients?: ProjectClient[];
  tasks?: Array<{ id: string; status: string }>;
}

interface ProjectStats {
  total: number;
  inProgress: number;
  inReview: number;
  completed: number;
  waitingOnClients: number;
  waitingReviews: number;
  waitingSignatures: number;
}

interface InvoiceStats {
  totalInvoices: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  openCount?: number;
  overdueCount?: number;
}

interface PendingApproval {
  id: string;
  title: string;
  status: string;
  version: number;
  sentAt: string | null;
  projectId: string;
  projectName: string;
  latestReason: string | null;
  decidedBy: string | null;
}

interface OverdueInvoice {
  id: string;
  invoiceNumber: string;
  amount: number;
  dueDate: string;
  projectId?: string;
  project?: { name: string };
  client?: { name: string };
}

interface ActivityItem {
  id: string;
  type: string;
  action: string;
  targetTitle: string;
  detail?: string;
  createdAt: string;
  actor: { id: string; name: string };
  project?: { id: string; name: string };
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export default function DashboardPage() {
  const currency = useCurrency();
  const { session } = useSession();

  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [invoiceStats, setInvoiceStats] = useState<InvoiceStats | null>(null);
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [overdueInvoices, setOverdueInvoices] = useState<OverdueInvoice[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [error, setError] = useState("");

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = session?.user?.name ? session.user.name.split(" ")[0] : "there";
  const formattedToday = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  useEffect(() => {
    // 1. Project stats
    apiFetch<ProjectStats>("/projects/stats")
      .then(setStats)
      .catch((err) => setError(err.message || "Failed to load project stats"));

    // 2. Invoice stats
    apiFetch<InvoiceStats>("/invoices/stats")
      .then(setInvoiceStats)
      .catch(console.error);

    // 3. Recent projects
    apiFetch<PaginatedResponse<Project>>("/projects?limit=5")
      .then((res) => setRecentProjects(res.data))
      .catch(console.error);

    // 4. Pending approvals
    apiFetch<PendingApproval[]>("/documents/approvals/pending")
      .then((res) => setPendingApprovals(res || []))
      .catch(() => setPendingApprovals([]));

    // 5. Overdue invoices
    apiFetch<PaginatedResponse<OverdueInvoice>>("/invoices?status=overdue&limit=3")
      .then((res) => setOverdueInvoices(res.data || []))
      .catch(() => setOverdueInvoices([]));

    // 6. Recent activity
    apiFetch<ActivityItem[]>("/activity?limit=5")
      .then((res) => setActivity(res || []))
      .catch(() => setActivity([]));
  }, []);

  const totalAttentionItems = pendingApprovals.length + overdueInvoices.length;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "in_progress":
        return {
          label: "In Progress",
          bg: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
          dot: "bg-blue-600",
        };
      case "in_review":
        return {
          label: "In Review",
          bg: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
          dot: "bg-purple-600",
        };
      case "completed":
        return {
          label: "Completed",
          bg: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          dot: "bg-emerald-600",
        };
      case "not_started":
        return {
          label: "Not Started",
          bg: "bg-[var(--muted)] text-[var(--muted-foreground)]",
          dot: "bg-neutral-400",
        };
      case "cancelled":
        return {
          label: "Cancelled",
          bg: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
          dot: "bg-rose-600",
        };
      default:
        return {
          label: status.replace(/_/g, " "),
          bg: "bg-[var(--muted)] text-[var(--foreground)]",
          dot: "bg-neutral-400",
        };
    }
  };

  const getClientDisplayName = (project: Project): string => {
    if (project.clients && project.clients.length > 0) {
      const client = project.clients[0]?.user;
      if (client?.name) return client.name;
      if (client?.email) return client.email.split("@")[0];
    }
    return "Internal";
  };

  const calculateProgress = (project: Project): number => {
    if (project.status === "completed") return 100;
    if (!project.tasks || project.tasks.length === 0) return 0;
    const completed = project.tasks.filter((t) => t.status === "done").length;
    return Math.round((completed / project.tasks.length) * 100);
  };

  const formatDueDate = (dateStr?: string | null): string => {
    if (!dateStr) return "—";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return "—";
    }
  };

  // Upcoming items for "This week"
  const thisWeekProjects = recentProjects.filter((p) => p.endDate && p.status !== "completed");

  return (
    <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs sm:text-sm text-[var(--muted-foreground)]">{formattedToday}</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--foreground)] mt-0.5">
            {greeting}, {firstName}
          </h1>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href="/dashboard/projects?new=1"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--primary)] text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm"
          >
            <Plus size={16} />
            <span>New Project</span>
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 text-sm text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl">
          {error}
        </div>
      )}

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {stats === null ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            {/* Active projects */}
            <Link
              href="/dashboard/projects"
              className="p-4 sm:p-5 border border-[var(--border)] rounded-2xl bg-[var(--background)] space-y-1 block hover:border-[var(--primary)] hover:shadow-md transition-all active:scale-[0.98] group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs sm:text-sm text-[var(--muted-foreground)] font-medium group-hover:text-[var(--primary)] transition-colors">
                  Active projects
                </p>
                <ChevronRight size={14} className="text-[var(--muted-foreground)] group-hover:text-[var(--primary)] transition-colors" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--foreground)]">
                {stats.total}
              </p>
              <p className="text-xs text-[var(--muted-foreground)] pt-0.5">
                {stats.inProgress} in progress · {stats.inReview} in review
              </p>
            </Link>

            {/* Waiting on clients */}
            <a
              href="#attention"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("attention")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="p-4 sm:p-5 border border-[var(--border)] rounded-2xl bg-[var(--background)] space-y-1 block hover:border-[var(--primary)] hover:shadow-md transition-all active:scale-[0.98] group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs sm:text-sm text-[var(--muted-foreground)] font-medium group-hover:text-[var(--primary)] transition-colors">
                  Waiting on clients
                </p>
                <ChevronRight size={14} className="text-[var(--muted-foreground)] group-hover:text-[var(--primary)] transition-colors" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--foreground)]">
                {stats.waitingOnClients}
              </p>
              <p className="text-xs text-[var(--muted-foreground)] pt-0.5">
                {stats.waitingReviews} {stats.waitingReviews === 1 ? "review" : "reviews"} · {stats.waitingSignatures} {stats.waitingSignatures === 1 ? "signature" : "signatures"}
              </p>
            </a>

            {/* Completed */}
            <Link
              href="/dashboard/projects"
              className="p-4 sm:p-5 border border-[var(--border)] rounded-2xl bg-[var(--background)] space-y-1 block hover:border-[var(--primary)] hover:shadow-md transition-all active:scale-[0.98] group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs sm:text-sm text-[var(--muted-foreground)] font-medium group-hover:text-[var(--primary)] transition-colors">
                  Completed
                </p>
                <ChevronRight size={14} className="text-[var(--muted-foreground)] group-hover:text-[var(--primary)] transition-colors" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--foreground)]">
                {stats.completed}
              </p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium pt-0.5">
                Total delivered
              </p>
            </Link>

            {/* Outstanding (Highlighted Brass / Amber Card) */}
            <a
              href="#attention"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("attention")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="p-4 sm:p-5 border border-amber-500/20 bg-amber-500/10 dark:bg-amber-950/30 dark:border-amber-800/40 rounded-2xl space-y-1 block hover:border-amber-500/50 hover:shadow-md transition-all active:scale-[0.98] group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs sm:text-sm text-amber-900 dark:text-amber-200 font-medium group-hover:text-amber-700 dark:group-hover:text-amber-100 transition-colors">
                  Outstanding
                </p>
                <ChevronRight size={14} className="text-amber-700/60 dark:text-amber-400/60 group-hover:text-amber-900 dark:group-hover:text-amber-100 transition-colors" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold tracking-tight text-amber-950 dark:text-amber-100">
                {formatCurrency(invoiceStats?.outstandingAmount ?? 0, currency)}
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80 pt-0.5">
                {invoiceStats?.openCount ?? 0} open invoices · {invoiceStats?.overdueCount ?? 0} overdue
              </p>
            </a>
          </>
        )}
      </div>

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column (2 cols) */}
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {/* Needs your attention Card */}
          <section
            id="attention"
            data-testid="pending-approvals-card"
            className="border border-[var(--border)] rounded-2xl bg-[var(--background)] overflow-hidden shadow-sm scroll-mt-6"
          >
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-[var(--border)]">
              <h2 className="text-sm sm:text-base font-semibold text-[var(--foreground)]">Needs your attention</h2>
              <span className="text-xs text-[var(--muted-foreground)]">
                {totalAttentionItems} {totalAttentionItems === 1 ? "item" : "items"}
              </span>
            </div>

            {totalAttentionItems === 0 ? (
              <div className="p-8 text-center space-y-2">
                <CheckCircle2 size={32} className="mx-auto text-emerald-500/80" />
                <p className="text-sm font-medium text-[var(--foreground)]">All caught up!</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  No deliverables or overdue invoices currently requiring client action.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {/* Deliverables awaiting review */}
                {pendingApprovals.map((item) => (
                  <div
                    key={`approval-${item.id}`}
                    className="flex items-center gap-3.5 p-4 sm:p-5 hover:bg-[var(--muted)]/40 transition-colors"
                  >
                    <span className="w-9 h-9 rounded-full bg-purple-500/15 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0">
                      <Eye size={18} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--foreground)] truncate">
                        {item.title} is waiting on client review
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)] truncate mt-0.5">
                        {item.projectName}
                        {item.sentAt && ` · sent ${formatRelativeTime(item.sentAt)}`}
                      </p>
                    </div>
                    <Link
                      href={`/dashboard/projects/${item.projectId}?tab=files`}
                      className="text-xs font-semibold text-[var(--primary)] hover:underline shrink-0 flex items-center gap-1"
                    >
                      <span>Review</span>
                      <ChevronRight size={13} />
                    </Link>
                  </div>
                ))}

                {/* Overdue invoices */}
                {overdueInvoices.map((inv) => (
                  <div
                    key={`invoice-${inv.id}`}
                    className="flex items-center gap-3.5 p-4 sm:p-5 hover:bg-[var(--muted)]/40 transition-colors"
                  >
                    <span className="w-9 h-9 rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-300 flex items-center justify-center shrink-0">
                      <AlertCircle size={18} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--foreground)] truncate">
                        Invoice #{inv.invoiceNumber} is overdue
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)] truncate mt-0.5">
                        {inv.project?.name || inv.client?.name || "Client"} · {formatCurrency(inv.amount, currency)}
                      </p>
                    </div>
                    <Link
                      href={inv.projectId ? `/dashboard/projects/${inv.projectId}?tab=invoices` : "/dashboard/projects"}
                      className="text-xs font-semibold text-[var(--primary)] hover:underline shrink-0 flex items-center gap-1"
                    >
                      <span>View invoice</span>
                      <ChevronRight size={13} />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Recent projects Table Card */}
          <section className="border border-[var(--border)] rounded-2xl bg-[var(--background)] overflow-hidden shadow-sm">
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-[var(--border)]">
              <h2 className="text-sm sm:text-base font-semibold text-[var(--foreground)]">Recent projects</h2>
              <Link
                href="/dashboard/projects"
                className="text-xs font-semibold text-[var(--primary)] hover:underline flex items-center gap-1"
              >
                <span>View all</span>
                <ChevronRight size={13} />
              </Link>
            </div>

            {recentProjects.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--muted-foreground)]">
                No projects yet.{" "}
                <Link href="/dashboard/projects?new=1" className="text-[var(--primary)] hover:underline font-medium">
                  Create your first project
                </Link>
              </div>
            ) : (
              <>
                {/* Mobile View: Cards */}
                <div className="divide-y divide-[var(--border)] sm:hidden">
                  {recentProjects.map((p) => {
                    const badge = getStatusBadge(p.status);
                    const progress = calculateProgress(p);
                    return (
                      <Link
                        key={p.id}
                        href={`/dashboard/projects/${p.id}`}
                        className="block p-4 hover:bg-[var(--muted)]/40 transition-colors"
                      >
                        <div className="flex justify-between items-start gap-2">
                          <span className="font-semibold text-sm text-[var(--foreground)] truncate">
                            {p.name}
                          </span>
                          <span className="text-xs text-[var(--muted-foreground)] shrink-0">
                            {formatDueDate(p.endDate)}
                          </span>
                        </div>
                        <span className="block mt-0.5 text-xs text-[var(--muted-foreground)] truncate">
                          {getClientDisplayName(p)}
                        </span>
                        <div className="mt-3 flex items-center gap-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${badge.bg}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                            {badge.label}
                          </span>
                          <div className="flex-1 bg-[var(--muted)] rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-[var(--primary)] h-full rounded-full transition-all duration-300"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>

                {/* Tablet / Desktop View: Table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-xs font-medium text-[var(--muted-foreground)]">
                        <th className="py-3 px-5">Project</th>
                        <th className="py-3 px-3">Client</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3">Progress</th>
                        <th className="py-3 px-5 text-right">Due</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {recentProjects.map((p) => {
                        const badge = getStatusBadge(p.status);
                        const progress = calculateProgress(p);
                        return (
                          <tr key={p.id} className="hover:bg-[var(--muted)]/30 transition-colors">
                            <td className="py-3 px-5 font-semibold text-[var(--foreground)]">
                              <Link href={`/dashboard/projects/${p.id}`} className="hover:text-[var(--primary)] transition-colors">
                                {p.name}
                              </Link>
                            </td>
                            <td className="py-3 px-3 text-xs text-[var(--muted-foreground)]">
                              {getClientDisplayName(p)}
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.bg}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                                {badge.label}
                              </span>
                            </td>
                            <td className="py-3 px-3">
                              <div className="w-24 sm:w-28 bg-[var(--muted)] rounded-full h-1.5 overflow-hidden">
                                <div
                                  className="bg-[var(--primary)] h-full rounded-full transition-all duration-300"
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            </td>
                            <td className="py-3 px-5 text-right text-xs text-[var(--muted-foreground)]">
                              {formatDueDate(p.endDate)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>

        {/* Right Column (1 col) */}
        <div className="space-y-6 min-w-0">
          {/* Client activity Card */}
          <section className="p-4 sm:p-5 border border-[var(--border)] rounded-2xl bg-[var(--background)] space-y-4 shadow-sm">
            <h2 className="text-sm sm:text-base font-semibold text-[var(--foreground)]">Client activity</h2>
            {activity.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)] py-2">
                No recent activity recorded yet. As clients approve deliverables, vote, or comment, updates will appear here.
              </p>
            ) : (
              <ol className="space-y-4">
                {activity.map((item) => {
                  const initials = item.actor?.name
                    ? item.actor.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()
                    : "CL";

                  return (
                    <li key={item.id} className="flex items-start gap-3 text-xs">
                      <span className="w-7 h-7 rounded-full bg-[var(--muted)] text-[var(--foreground)] flex items-center justify-center font-bold text-[10px] shrink-0 border border-[var(--border)]">
                        {initials}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[var(--foreground)] leading-snug">
                          <strong className="font-semibold">{item.actor?.name || "Client"}</strong>{" "}
                          {item.action === "accepted" ? "approved" : item.action === "declined" ? "requested changes on" : item.action}{" "}
                          <strong className="font-semibold">{item.targetTitle}</strong>
                        </p>
                        <p className="text-[var(--muted-foreground)] text-[11px] mt-0.5">
                          {item.project?.name ? `${item.project.name} · ` : ""}
                          {formatRelativeTime(item.createdAt)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* This week Card */}
          <section className="p-4 sm:p-5 border border-[var(--border)] rounded-2xl bg-[var(--background)] space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm sm:text-base font-semibold text-[var(--foreground)]">This week</h2>
              <Link
                href="/dashboard/calendar"
                className="text-xs font-semibold text-[var(--primary)] hover:underline flex items-center gap-1"
              >
                <span>Calendar</span>
                <ChevronRight size={13} />
              </Link>
            </div>

            {thisWeekProjects.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)] py-2">
                No pending deadlines this week.
              </p>
            ) : (
              <ul className="space-y-3">
                {thisWeekProjects.map((p) => {
                  const d = p.endDate ? new Date(p.endDate) : new Date();
                  const weekday = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
                  const dayNum = d.getDate();

                  return (
                    <li key={p.id} className="flex items-center gap-3">
                      <div className="w-11 py-1 text-center rounded-lg bg-[var(--muted)] shrink-0 border border-[var(--border)]">
                        <span className="block text-[10px] font-medium text-[var(--muted-foreground)] leading-none">
                          {weekday}
                        </span>
                        <span className="block text-sm font-bold text-[var(--foreground)] leading-tight mt-0.5">
                          {dayNum}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/dashboard/projects/${p.id}`}
                          className="block text-xs font-semibold text-[var(--foreground)] hover:text-[var(--primary)] truncate transition-colors"
                        >
                          {p.name}
                        </Link>
                        <span className="block text-[11px] text-[var(--muted-foreground)] truncate mt-0.5">
                          {getClientDisplayName(p)} · Target completion
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
