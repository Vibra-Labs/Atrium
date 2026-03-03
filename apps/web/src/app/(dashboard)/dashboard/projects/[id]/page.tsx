"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { ProjectDetailSkeleton } from "@/components/skeletons";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Trash2, Calendar } from "lucide-react";
import { StatusPipeline } from "./components/status-pipeline";
import { ClientAssignment } from "./components/client-assignment";
import { TasksSection } from "./components/tasks-section";
import { UpdatesSection } from "./components/updates-section";
import { FilesSection } from "./components/files-section";
import { InvoicesSection } from "./components/invoices-section";
import { NotesSection } from "./components/notes-section";

interface FileRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  archivedAt?: string | null;
  clients?: { userId: string }[];
  files: FileRecord[];
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
          className="text-sm bg-transparent border border-[var(--border)] rounded px-2 py-1 w-[170px] text-right disabled:opacity-50 cursor-pointer hover:border-[var(--muted-foreground)] transition-colors"
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
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [clients, setClients] = useState<ClientMember[]>([]);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("updates");
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const isArchived = !!project?.archivedAt;
  const isOwner = currentRole === "owner";

  const loadProject = useCallback(() => {
    apiFetch<Project>(`/projects/${id}`)
      .then(setProject)
      .catch((err) => setError(err.message || "Failed to load project"));
  }, [id]);

  useEffect(() => {
    loadProject();
    apiFetch<ProjectStatus[]>("/projects/statuses")
      .then(setStatuses)
      .catch(console.error);
    apiFetch<ClientMember[] | PaginatedResponse<ClientMember>>("/clients")
      .then((res) => {
        const data = Array.isArray(res) ? res : res.data;
        setClients(data.filter((m: ClientMember) => m.role === "member"));
      })
      .catch(console.error);
    apiFetch<{ role: string }>("/auth/organization/get-active-member")
      .then((member) => setCurrentRole(member.role))
      .catch(console.error);
  }, [loadProject, id]);

  const handleStatusChange = async (status: string) => {
    if (isArchived) return;
    await apiFetch(`/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
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
    const newIds = (project.clients ?? [])
      .map((c) => c.userId)
      .filter((cid) => cid !== userId);
    await apiFetch(`/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify({ clientUserIds: newIds }),
    });
    loadProject();
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

  return (
    <div className="flex gap-8 items-start">
      {/* Left sidebar — project metadata */}
      <aside className="w-72 shrink-0 sticky top-8 space-y-4">
        {error && (
          <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
        )}

        {isArchived && (
          <div className="p-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
            <Archive size={14} />
            Archived. Editing disabled.
          </div>
        )}

        <div className="flex items-start justify-between gap-2">
          <h1 className="text-lg font-bold leading-tight">{project.name}</h1>
          {isArchived ? (
            <button
              onClick={handleUnarchive}
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 border border-[var(--border)] rounded-lg text-xs hover:bg-[var(--muted)] transition-colors"
            >
              <ArchiveRestore size={13} />
              Unarchive
            </button>
          ) : (
            <button
              onClick={handleArchive}
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 border border-[var(--border)] rounded-lg text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Archive size={13} />
              Archive
            </button>
          )}
        </div>
        {project.description && (
          <p className="text-xs text-[var(--muted-foreground)] leading-relaxed -mt-1">
            {project.description}
          </p>
        )}

        <StatusPipeline
          statuses={statuses}
          currentStatus={project.status}
          onStatusChange={handleStatusChange}
          disabled={isArchived}
        />

        <ClientAssignment
          clients={clients}
          assignedIds={assignedIds}
          onToggle={handleClientToggle}
          onRemove={handleRemoveClient}
          disabled={isArchived}
        />

        <div className="border-t border-[var(--border)]" />

        <div className="space-y-1.5">
          <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-1.5 mb-2">
            <Calendar size={12} />
            Timeline
          </h2>
          <DateField
            label="Start"
            value={project.startDate ? project.startDate.slice(0, 10) : ""}
            onChange={(val) => handleDateChange("startDate", val)}
            disabled={isArchived}
          />
          <DateField
            label="End"
            value={project.endDate ? project.endDate.slice(0, 10) : ""}
            onChange={(val) => handleDateChange("endDate", val)}
            disabled={isArchived}
          />
          {project.endDate && !isArchived && (() => {
            const now = new Date();
            const end = new Date(project.endDate);
            const diffMs = end.getTime() - now.getTime();
            const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            if (diffDays < 0) {
              return (
                <p className="text-xs text-red-500 font-medium">
                  {Math.abs(diffDays)} day{Math.abs(diffDays) !== 1 ? "s" : ""} overdue
                </p>
              );
            }
            if (diffDays === 0) {
              return <p className="text-xs text-amber-600 font-medium">Due today</p>;
            }
            return (
              <p className={`text-xs font-medium ${diffDays <= 7 ? "text-amber-600" : "text-[var(--muted-foreground)]"}`}>
                {diffDays} day{diffDays !== 1 ? "s" : ""} left
              </p>
            );
          })()}
        </div>

        {isOwner && (
          <>
            <div className="border-t border-[var(--border)]" />
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 transition-colors"
            >
              <Trash2 size={13} />
              Delete project
            </button>
          </>
        )}
      </aside>

      {/* Right content area — tabbed sections */}
      <div className="flex-1 min-w-0">
        <div className="flex border-b border-[var(--border)] mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? "border-[var(--primary)] text-[var(--primary)]"
                  : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--border)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "tasks" && (
          <TasksSection projectId={id} isArchived={isArchived} />
        )}
        {activeTab === "updates" && (
          <UpdatesSection projectId={id} isArchived={isArchived} onFileChange={loadProject} />
        )}
        {activeTab === "files" && (
          <FilesSection
            projectId={id}
            isArchived={isArchived}
            files={project.files}
            onFileChange={loadProject}
          />
        )}
        {activeTab === "invoices" && (
          <InvoicesSection projectId={id} isArchived={isArchived} />
        )}
        {activeTab === "notes" && (
          <NotesSection projectId={id} isArchived={isArchived} />
        )}
      </div>
    </div>
  );
}
