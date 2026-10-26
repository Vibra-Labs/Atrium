"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { ProjectDetailSkeleton } from "@/components/skeletons";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Trash2, Calendar, ChevronDown, Tag, Copy, Eye } from "lucide-react";
import { track } from "@/lib/track";
import { startPreview } from "@/lib/preview-mode";
import { LabelBadge } from "@/components/label-badge";
import { LabelPicker } from "@/components/label-picker";
import { StatusPipeline } from "./components/status-pipeline";
import { ClientAssignment } from "./components/client-assignment";
import { TasksSection } from "./components/tasks-section";
import { UpdatesSection } from "./components/updates-section";
import { FilesSection } from "./components/files-section";
import { InvoicesSection } from "./components/invoices-section";
import { NotesSection } from "./components/notes-section";
import { TimeTab } from "./time-tab";
import { useSession } from "@/lib/session-context";
import { useCachedApi } from "@/lib/cached";
import { formatCurrency } from "@/lib/format";
import { useCurrency } from "@/lib/app-config";

interface FileRecord {
  id: string;
  filename: string;
  type?: "UPLOAD" | "LINK";
  mimeType?: string | null;
  sizeBytes?: number | null;
  url?: string | null;
  description?: string | null;
  createdAt: string;
}

interface LabelRecord {
  id: string;
  name: string;
  color: string;
}

interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  archivedAt?: string | null;
  hourlyRateCents?: number | null;
  clients?: { userId: string }[];
  files: FileRecord[];
  labels?: { label: LabelRecord }[];
}

interface ProjectStatus {
  id: string;
  name: string;
  slug: string;
  color: string;
  order: number;
}

interface ClientMember {
  id: string;
  userId: string;
  role: string;
  user: { id: string; name: string; email: string };
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

const tabs = [
  { id: "updates", label: "Updates" },
  { id: "tasks", label: "Tasks" },
  { id: "files", label: "Files" },
  { id: "time", label: "Time" },
  { id: "invoices", label: "Invoices" },
  { id: "notes", label: "Notes" },
] as const;

type TabId = (typeof tabs)[number]["id"];

function formatDateDisplay(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function DateField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-[var(--muted-foreground)] shrink-0">{label}</span>
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.showPicker()}
          className="text-sm bg-transparent border border-[var(--border)] rounded px-2 py-1 w-[140px] sm:w-[170px] text-right disabled:opacity-50 cursor-pointer hover:border-[var(--muted-foreground)] transition-colors"
        >
          {value ? formatDateDisplay(value) : <span className="text-[var(--muted-foreground)]">Select date</span>}
        </button>
        <input
          ref={inputRef}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="absolute inset-0 opacity-0 pointer-events-none"
          tabIndex={-1}
        />
      </div>
    </div>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const statuses: ProjectStatus[] = useCachedApi<ProjectStatus[]>("/projects/statuses") ?? [];
  const [clients, setClients] = useState<ClientMember[]>([]);
  const [error, setError] = useState("");
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam && tabs.some((t) => t.id === tabParam)) return tabParam as TabId;
    if (searchParams.get("task")) return "tasks";
    return "updates";
  });

  // When a ?task=<id> deep link is set (e.g. from a notification or
  // cross-tab share), jump to the Tasks tab so the detail modal can open.
  // When a ?tab=<id> deep link is set (e.g. from the timer widget), jump to it.
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam && tabs.some((t) => t.id === tabParam)) {
      setActiveTab(tabParam as TabId);
      return;
    }
    if (searchParams.get("task")) setActiveTab("tasks");
  }, [searchParams]);
  const session = useSession();
  const currentRole: string | null = session.role || null;
  const currentUserId: string | null = session.userId || null;
  const orgLabels: LabelRecord[] = useCachedApi<LabelRecord[]>("/labels") ?? [];
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicateIncludeTasks, setDuplicateIncludeTasks] = useState(true);
  const [duplicateIncludeClients, setDuplicateIncludeClients] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const isArchived = !!project?.archivedAt;
  const isOwner = currentRole === "owner";

  const loadProject = useCallback(() => {
    apiFetch<Project>(`/projects/${id}`)
      .then(setProject)
      .catch((err) => setError(err.message || "Failed to load project"));
  }, [id]);

  const [billingStats, setBillingStats] = useState<{
    totalAmount: number;
    paidAmount: number;
    outstandingAmount: number;
  } | null>(null);
  const currency = useCurrency();

  const loadBillingStats = useCallback(() => {
    apiFetch<{
      totalAmount: number;
      paidAmount: number;
      outstandingAmount: number;
    }>(`/invoices/stats?projectId=${id}`)
      .then(setBillingStats)
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    loadBillingStats();
  }, [loadBillingStats]);

  useEffect(() => {
    loadProject();
    apiFetch<ClientMember[] | PaginatedResponse<ClientMember>>("/clients")
      .then((res) => {
        const data = Array.isArray(res) ? res : res.data;
        setClients(data.filter((m: ClientMember) => m.role === "member"));
      })
      .catch(console.error);
  }, [loadProject, id]);

  const handleStatusChange = async (status: string) => {
    if (isArchived) return;
    await apiFetch(`/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
    track("project_status_changed", { status });
    loadProject();
  };

  const handleClientToggle = async (userId: string) => {
    if (!project || isArchived) return;
    const currentIds = (project.clients ?? []).map((c) => c.userId);
    const newIds = currentIds.includes(userId)
      ? currentIds.filter((cid) => cid !== userId)
      : [...currentIds, userId];
    await apiFetch(`/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify({ clientUserIds: newIds }),
    });
    loadProject();
  };

  const handleRemoveClient = async (userId: string) => {
    if (!project || isArchived) return;
    const client = clients.find((c) => c.userId === userId);
    const ok = await confirm({
      title: "Remove client from project?",
      message: client
        ? `${client.user.name} will no longer see this project in their portal. You can re-add them at any time.`
        : "This client will no longer see this project in their portal. You can re-add them at any time.",
      confirmLabel: "Remove client",
      variant: "danger",
    });
    if (!ok) return;
    const newIds = (project.clients ?? [])
      .map((c) => c.userId)
      .filter((cid) => cid !== userId);
    await apiFetch(`/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify({ clientUserIds: newIds }),
    });
    loadProject();
  };

  const handlePreviewAsClient = (
    clientUserId: string,
    clientName: string,
    clientEmail: string,
  ) => {
    track("client_viewed_as", { from: "project" });
    startPreview(
      clientUserId,
      clientName,
      clientEmail,
      `/dashboard/projects/${id}`,
      `/portal/projects/${id}`,
    );
  };

  const handleDateChange = async (field: "startDate" | "endDate", value: string) => {
    if (isArchived) return;
    try {
      await apiFetch(`/projects/${id}`, {
        method: "PUT",
        body: JSON.stringify({ [field]: value || null }),
      });
      loadProject();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update date");
    }
  };

  const handleRateChange = async (rawValue: string) => {
    if (isArchived) return;
    const trimmed = rawValue.trim();
    let cents: number | null = null;
    if (trimmed !== "") {
      const dollars = Number(trimmed);
      if (!Number.isFinite(dollars) || dollars < 0) {
        showError("Enter a valid non-negative rate");
        return;
      }
      cents = Math.round(dollars * 100);
    }
    const current = project?.hourlyRateCents ?? null;
    if (current === cents) return;
    try {
      await apiFetch(`/projects/${id}`, {
        method: "PUT",
        body: JSON.stringify({ hourlyRateCents: cents }),
      });
      success("Rate updated");
      loadProject();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update rate");
    }
  };

  const handleLabelToggle = async (labelId: string) => {
    if (!project || isArchived) return;
    const assignedIds = (project.labels ?? []).map((l) => l.label.id);
    const isAssigned = assignedIds.includes(labelId);
    try {
      if (isAssigned) {
        await apiFetch(`/labels/${labelId}/assign`, {
          method: "DELETE",
          body: JSON.stringify({ entityType: "project", entityId: id }),
        });
      } else {
        await apiFetch(`/labels/${labelId}/assign`, {
          method: "POST",
          body: JSON.stringify({ entityType: "project", entityId: id }),
        });
      }
      loadProject();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update labels");
    }
  };

  const handleArchive = async () => {
    const ok = await confirm({
      title: "Archive Project",
      message: "Archive this project? It will be hidden from clients and editing will be disabled.",
      confirmLabel: "Archive",
    });
    if (!ok) return;
    try {
      await apiFetch(`/projects/${id}/archive`, { method: "POST" });
      loadProject();
      success("Project archived");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to archive project");
    }
  };

  const handleUnarchive = async () => {
    try {
      await apiFetch(`/projects/${id}/unarchive`, { method: "POST" });
      loadProject();
      success("Project unarchived");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to unarchive project");
    }
  };

  const openDuplicateModal = () => {
    setDuplicateName(project ? `${project.name} (copy)` : "");
    setDuplicateIncludeTasks(true);
    setDuplicateIncludeClients(false);
    setDuplicateOpen(true);
  };

  const handleDuplicate = async () => {
    const name = duplicateName.trim();
    if (!name) {
      showError("Name is required");
      return;
    }
    setDuplicating(true);
    try {
      const created = await apiFetch<{ id: string }>(`/projects/${id}/duplicate`, {
        method: "POST",
        body: JSON.stringify({
          name,
          includeTasks: duplicateIncludeTasks,
          includeClients: duplicateIncludeClients,
        }),
      });
      success("Project duplicated");
      setDuplicateOpen(false);
      router.push(`/dashboard/projects/${created.id}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to duplicate project");
    } finally {
      setDuplicating(false);
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete Project",
      message: "Permanently delete this project and all its data? This cannot be undone.",
      confirmLabel: "Delete",
      confirmText: project?.name ?? "",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/projects/${id}`, { method: "DELETE" });
      success("Project deleted");
      router.push("/dashboard/projects");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete project");
    }
  };

  if (!project) return <ProjectDetailSkeleton />;

  const assignedIds = new Set((project.clients ?? []).map((c) => c.userId));
  const assignedClients = clients.filter((c) => assignedIds.has(c.userId));
  const projectLabelIds = (project.labels ?? []).map((l) => l.label.id);

  const currentStatusObj = statuses.find((s) => s.slug === project.status);

  const tabBar = (
    <div className="relative border-b border-[var(--border)] -mx-1">
      <div className="flex overflow-x-auto px-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] gap-1">
        {tabs.map((tab) => {
          const count =
            tab.id === "files" && project.files?.length
              ? ` (${project.files.length})`
              : "";
          return (
            <button
              key={tab.id}
              data-testid={`project-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full ${
                activeTab === tab.id
                  ? "text-[var(--primary)] after:bg-[var(--primary)] font-semibold"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] after:bg-transparent"
              }`}
            >
              {tab.label}
              {count}
            </button>
          );
        })}
      </div>
    </div>
  );

  const tabContent = (
    <>
      {activeTab === "tasks" && (
        <TasksSection projectId={id} isArchived={isArchived} onGoToFiles={() => setActiveTab("files")} />
      )}
      {activeTab === "updates" && (
        <UpdatesSection
          projectId={id}
          isArchived={isArchived}
          onFileChange={() => {
            loadProject();
            loadBillingStats();
          }}
          currentUserId={currentUserId}
          currentRole={currentRole}
        />
      )}
      {activeTab === "files" && (
        <FilesSection
          projectId={id}
          isArchived={isArchived}
          files={project.files}
          onFileChange={() => {
            loadProject();
            loadBillingStats();
          }}
          projectClients={clients.filter((c) => assignedIds.has(c.userId))}
          currentRole={currentRole}
        />
      )}
      {activeTab === "time" && (
        <TimeTab projectId={id} isArchived={isArchived} />
      )}
      {activeTab === "invoices" && (
        <InvoicesSection projectId={id} isArchived={isArchived} />
      )}
      {activeTab === "notes" && (
        <NotesSection projectId={id} isArchived={isArchived} />
      )}
    </>
  );

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 text-sm text-rose-700 dark:text-rose-300 bg-rose-500/15 rounded-lg">{error}</div>
      )}

      {isArchived && (
        <div className="p-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
          <Archive size={14} />
          Archived. Editing disabled.
        </div>
      )}

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="text-xs text-[var(--muted-foreground)] flex items-center gap-1.5">
        <Link href="/dashboard/projects" className="hover:text-[var(--foreground)] transition-colors">
          Projects
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-[var(--foreground)] font-medium truncate">{project.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--foreground)]">
            {project.name}
          </h1>
          <p className="text-xs sm:text-sm text-[var(--muted-foreground)] mt-1">
            {assignedClients.length > 0 && (
              <span>{assignedClients.map((c) => c.user.name).join(", ")} &middot; </span>
            )}
            {project.startDate && (
              <span>Started {formatDateDisplay(project.startDate.slice(0, 10))} &middot; </span>
            )}
            {project.endDate && (
              <span>Due {formatDateDisplay(project.endDate.slice(0, 10))}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(currentRole === "owner" || currentRole === "admin") && (
            <button
              type="button"
              onClick={() => {
                if (assignedClients.length > 0) {
                  handlePreviewAsClient(
                    assignedClients[0].userId,
                    assignedClients[0].user?.name || "Client",
                    assignedClients[0].user?.email || "",
                  );
                } else {
                  handlePreviewAsClient(
                    currentUserId || "",
                    "Client Preview",
                    "client@preview.local",
                  );
                }
              }}
              className="inline-flex items-center gap-2 px-3.5 py-2 border border-[var(--border)] rounded-lg text-xs sm:text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] hover:border-[var(--primary)] transition-all shadow-sm"
              title="Preview this project as a client"
            >
              <Eye size={15} className="text-[var(--primary)]" />
              <span>View as client</span>
            </button>
          )}
          {(currentRole === "owner" || currentRole === "admin") && (
            <button
              type="button"
              onClick={openDuplicateModal}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] rounded-lg text-xs sm:text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Copy size={14} />
              <span>Duplicate</span>
            </button>
          )}
          {isArchived ? (
            <button
              type="button"
              onClick={handleUnarchive}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] rounded-lg text-xs sm:text-sm font-medium hover:bg-[var(--muted)] transition-colors"
            >
              <ArchiveRestore size={14} />
              <span>Unarchive</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleArchive}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] rounded-lg text-xs sm:text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Archive size={14} />
              <span>Archive</span>
            </button>
          )}
        </div>
      </div>

      {/* Status Pipeline */}
      <div>
        <StatusPipeline
          statuses={statuses}
          currentStatus={project.status}
          onStatusChange={handleStatusChange}
          disabled={isArchived}
        />
      </div>

      {/* Tab Navigation */}
      {tabBar}

      {/* Main 2-Column Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column (2 cols) */}
        <div className="lg:col-span-2 min-w-0 space-y-6">
          {tabContent}
        </div>

        {/* Right Column (1 col) */}
        <aside className="space-y-6 lg:sticky lg:top-6 min-w-0">
          {/* Clients Card */}
          <section className="p-4 sm:p-5 rounded-2xl bg-[var(--background)] border border-[var(--border)] space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Clients{assignedIds.size > 0 && ` (${assignedIds.size})`}
            </h2>
            <ClientAssignment
              clients={clients}
              assignedIds={assignedIds}
              onToggle={handleClientToggle}
              onRemove={handleRemoveClient}
              onPreview={
                currentRole === "owner" || currentRole === "admin"
                  ? handlePreviewAsClient
                  : undefined
              }
              disabled={isArchived}
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              They see this project in their client portal
            </p>
          </section>

          {/* Timeline Card */}
          <section className="p-4 sm:p-5 rounded-2xl bg-[var(--background)] border border-[var(--border)] space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-1.5">
              <Calendar size={13} />
              Timeline
            </h2>
            <DateField
              label="Start"
              value={project.startDate ? project.startDate.slice(0, 10) : ""}
              onChange={(val) => handleDateChange("startDate", val)}
              disabled={isArchived}
            />
            <DateField
              label="Due"
              value={project.endDate ? project.endDate.slice(0, 10) : ""}
              onChange={(val) => handleDateChange("endDate", val)}
              disabled={isArchived}
            />
            {project.startDate && project.endDate && (() => {
              const start = new Date(project.startDate).getTime();
              const end = new Date(project.endDate).getTime();
              const now = Date.now();
              const total = Math.max(1, end - start);
              const elapsed = Math.min(total, Math.max(0, now - start));
              const pct = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
              return (
                <div className="w-full bg-[var(--muted)] rounded-full h-1.5 overflow-hidden my-1">
                  <div
                    className="bg-[var(--primary)] h-full rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              );
            })()}
            {project.endDate && !isArchived && (() => {
              const now = new Date();
              const end = new Date(project.endDate);
              const diffMs = end.getTime() - now.getTime();
              const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
              if (diffDays < 0) {
                return (
                  <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                    {Math.abs(diffDays)} day{Math.abs(diffDays) !== 1 ? "s" : ""} overdue
                  </p>
                );
              }
              if (diffDays === 0) {
                return <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">Due today</p>;
              }
              return (
                <p className={`text-xs font-medium ${diffDays <= 7 ? "text-amber-600 dark:text-amber-400" : "text-[var(--muted-foreground)]"}`}>
                  {diffDays} day{diffDays !== 1 ? "s" : ""} left
                </p>
              );
            })()}
          </section>

          {/* Billing Card */}
          {(currentRole === "owner" || currentRole === "admin") && (
            <section className="p-4 sm:p-5 rounded-2xl bg-[var(--background)] border border-[var(--border)] space-y-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Billing
              </h2>
              <div className="flex justify-between items-center text-sm">
                <span className="text-[var(--muted-foreground)]">Invoiced</span>
                <span className="font-semibold text-[var(--foreground)]">
                  {formatCurrency(billingStats?.totalAmount ?? 0, currency)}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-[var(--muted-foreground)]">Paid</span>
                <span className="text-[var(--foreground)]">
                  {formatCurrency(billingStats?.paidAmount ?? 0, currency)}
                </span>
              </div>
              <div className="flex justify-between items-center px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-800 dark:text-amber-300 font-medium text-sm">
                <span>Outstanding</span>
                <span className="font-bold">
                  {formatCurrency(billingStats?.outstandingAmount ?? 0, currency)}
                </span>
              </div>
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("invoices")}
                  className="text-xs font-semibold text-[var(--primary)] hover:underline"
                >
                  + New invoice
                </button>
              </div>
            </section>
          )}

          {/* Project Details Card */}
          <section className="p-4 sm:p-5 rounded-2xl bg-[var(--background)] border border-[var(--border)] space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Project Details
            </h2>

            {/* Labels */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--muted-foreground)] flex items-center gap-1.5">
                  <Tag size={12} />
                  Labels
                </span>
                <LabelPicker
                  labels={orgLabels}
                  assigned={projectLabelIds}
                  onToggle={handleLabelToggle}
                  disabled={isArchived}
                />
              </div>
              {projectLabelIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(project.labels ?? []).map((l) => (
                    <LabelBadge key={l.label.id} name={l.label.name} color={l.label.color} />
                  ))}
                </div>
              )}
            </div>

            {/* Default Rate */}
            {(currentRole === "owner" || currentRole === "admin") && (
              <div className="space-y-1.5 pt-2 border-t border-[var(--border)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-[var(--muted-foreground)]">Default rate ($/hr)</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    placeholder="Member rate"
                    defaultValue={
                      project.hourlyRateCents != null
                        ? (project.hourlyRateCents / 100).toString()
                        : ""
                    }
                    key={project.hourlyRateCents ?? "empty"}
                    onBlur={(e) => handleRateChange(e.target.value)}
                    disabled={isArchived}
                    className="w-24 text-xs bg-transparent border border-[var(--border)] rounded px-2 py-1 text-right disabled:opacity-50"
                  />
                </div>
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  Overrides each member&apos;s default rate for this project.
                </p>
              </div>
            )}

            {/* Delete Project */}
            {isOwner && (
              <div className="pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-700 transition-colors"
                >
                  <Trash2 size={13} />
                  Delete project
                </button>
              </div>
            )}
          </section>
        </aside>
      </div>

      {duplicateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) setDuplicateOpen(false); }}
        >
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-[480px] mx-4 p-6 space-y-4">
            <h3 className="text-lg font-semibold">Duplicate Project</h3>
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="block mb-1 text-[var(--muted-foreground)]">Name</span>
                <input
                  type="text"
                  value={duplicateName}
                  onChange={(e) => setDuplicateName(e.target.value)}
                  autoFocus
                  maxLength={255}
                  className="w-full bg-transparent border border-[var(--border)] rounded px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={duplicateIncludeTasks}
                  onChange={(e) => setDuplicateIncludeTasks(e.target.checked)}
                />
                Include tasks
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={duplicateIncludeClients}
                  onChange={(e) => setDuplicateIncludeClients(e.target.checked)}
                />
                Include client assignments
              </label>
              <p className="text-xs text-[var(--muted-foreground)]">
                Files, updates, invoices, and notes are not copied.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDuplicateOpen(false)}
                disabled={duplicating}
                className="px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDuplicate}
                disabled={duplicating || !duplicateName.trim()}
                className="px-3 py-1.5 text-sm bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {duplicating ? "Duplicating…" : "Duplicate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
