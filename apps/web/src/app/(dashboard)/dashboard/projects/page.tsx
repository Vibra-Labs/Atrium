"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useDebounce } from "@/hooks/use-debounce";
import { Pagination } from "@/components/pagination";
import { ProjectCardSkeleton } from "@/components/skeletons";
import { Plus, Search, FolderOpen, Archive, Tag, Download } from "lucide-react";
import { track } from "@/lib/track";
import { LabelBadge } from "@/components/label-badge";
import { downloadCsv } from "@/lib/download";

interface LabelRecord {
  id: string;
  name: string;
  color: string;
}

interface Project {
  id: string;
  name: string;
  status: string;
  description?: string;
  archivedAt?: string | null;
  createdAt: string;
  labels?: { label: LabelRecord }[];
}

interface ProjectStatus {
  id: string;
  name: string;
  slug: string;
  color: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  // Pagination & filters
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [orgLabels, setOrgLabels] = useState<LabelRecord[]>([]);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [labelFilterOpen, setLabelFilterOpen] = useState(false);
  const labelFilterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!labelFilterOpen) return;
    function handleClick(e: MouseEvent) {
      if (labelFilterRef.current && !labelFilterRef.current.contains(e.target as Node)) {
        setLabelFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [labelFilterOpen]);

  useEffect(() => {
    apiFetch<ProjectStatus[]>("/projects/statuses")
      .then(setStatuses)
      .catch(console.error);
    apiFetch<LabelRecord[]>("/labels")
      .then(setOrgLabels)
      .catch(console.error);
  }, []);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter) params.set("status", statusFilter);
      if (showArchived) params.set("archived", "true");
      if (labelFilter.length > 0) params.set("labels", labelFilter.join(","));
      const res = await apiFetch<PaginatedResponse<Project>>(
        `/projects?${params}`,
      );
      setProjects(res.data);
      setTotalPages(res.meta.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, statusFilter, showArchived, labelFilter]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, showArchived, labelFilter]);

  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      await apiFetch<Project>("/projects", {
        method: "POST",
        body: JSON.stringify({ name, description }),
      });
      track("project_created");
      setName("");
      setDescription("");
      setShowCreate(false);
      loadProjects();
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadCsv("/projects/export")}
            className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] rounded-lg text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
            title="Export CSV"
          >
            <Download size={16} />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90"
          >
            <Plus size={16} />
            New Project
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
      )}

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mb-6 p-4 border border-[var(--border)] rounded-lg space-y-3"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            required
            className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
            rows={2}
          />
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </form>
      )}

      {/* Search, Filter, Archive */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-0 w-full sm:w-auto sm:max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            maxLength={200}
            className="w-full pl-9 pr-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full sm:w-auto px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.slug}>
              {s.name}
            </option>
          ))}
        </select>
        {orgLabels.length > 0 && (
          <div ref={labelFilterRef} className="relative">
            <button
              type="button"
              onClick={() => setLabelFilterOpen(!labelFilterOpen)}
              className={`flex items-center gap-1.5 w-full sm:w-auto px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm ${
                labelFilter.length > 0 ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
              }`}
            >
              <Tag size={14} />
              Labels
              {labelFilter.length > 0 && (
                <span className="bg-[var(--primary)] text-white text-xs px-1.5 py-0.5 rounded-full">
                  {labelFilter.length}
                </span>
              )}
            </button>
            {labelFilterOpen && (
              <div className="absolute left-0 top-full mt-1 w-56 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg z-50 py-1 max-h-60 overflow-y-auto" role="listbox" aria-multiselectable="true">
                {orgLabels.map((label) => (
                  <div
                    key={label.id}
                    role="option"
                    aria-selected={labelFilter.includes(label.id)}
                    onClick={() =>
                      setLabelFilter((prev) =>
                        prev.includes(label.id)
                          ? prev.filter((id) => id !== label.id)
                          : [...prev, label.id],
                      )
                    }
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer"
                  >
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="flex-1 text-left truncate">{label.name}</span>
                    <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                      labelFilter.includes(label.id)
                        ? "bg-[var(--primary)] border-[var(--primary)] text-white"
                        : "border-[var(--border)]"
                    }`}>
                      {labelFilter.includes(label.id) && "✓"}
                    </span>
                  </div>
                ))}
                {labelFilter.length > 0 && (
                  <button
                    onClick={() => setLabelFilter([])}
                    className="w-full px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors border-t border-[var(--border)]"
                  >
                    Clear filter
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="rounded"
          />
          Show archived
        </label>
      </div>

      {loading ? (
        <div className="space-y-2">
          <ProjectCardSkeleton />
          <ProjectCardSkeleton />
          <ProjectCardSkeleton />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/dashboard/projects/${project.id}`}
                className="block p-4 border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium">{project.name}</h3>
                      {project.archivedAt && (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
                          <Archive size={12} />
                          Archived
                        </span>
                      )}
                    </div>
                    {project.labels && project.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {project.labels.map((l) => (
                          <LabelBadge key={l.label.id} name={l.label.name} color={l.label.color} />
                        ))}
                      </div>
                    )}
                    {project.description && (
                      <p className="text-sm text-[var(--muted-foreground)] mt-1">
                        {project.description}
                      </p>
                    )}
                  </div>
                  <span className="text-xs px-2 py-1 bg-[var(--muted)] rounded-full shrink-0 self-start">
                    {project.status.replace(/_/g, " ")}
                  </span>
                </div>
              </Link>
            ))}
            {projects.length === 0 && (
              <div className="text-center py-12">
                <FolderOpen size={40} className="mx-auto text-[var(--muted-foreground)] mb-3" />
                <p className="text-[var(--muted-foreground)]">
                  {debouncedSearch || statusFilter || labelFilter.length > 0
                    ? "No projects match your search."
                    : "No projects yet. Create your first one."}
                </p>
              </div>
            )}
          </div>
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
