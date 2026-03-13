"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useDebounce } from "@/hooks/use-debounce";
import { Pagination } from "@/components/pagination";
import { ProjectCardSkeleton } from "@/components/skeletons";
import { Plus, Search, FolderOpen, Archive } from "lucide-react";
import { track } from "@/lib/track";

interface Project {
  id: string;
  name: string;
  status: string;
  description?: string;
  archivedAt?: string | null;
  createdAt: string;
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

  useEffect(() => {
    apiFetch<ProjectStatus[]>("/projects/statuses")
      .then(setStatuses)
      .catch(console.error);
  }, []);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter) params.set("status", statusFilter);
      if (showArchived) params.set("archived", "true");
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
  }, [page, debouncedSearch, statusFilter, showArchived]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, showArchived]);

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
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90"
        >
          <Plus size={16} />
          New Project
        </button>
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
        <div className="relative flex-1 min-w-[200px] max-w-sm">
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
          className="px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.slug}>
              {s.name}
            </option>
          ))}
        </select>
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
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{project.name}</h3>
                      {project.archivedAt && (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
                          <Archive size={12} />
                          Archived
                        </span>
                      )}
                    </div>
                    {project.description && (
                      <p className="text-sm text-[var(--muted-foreground)] mt-1">
                        {project.description}
                      </p>
                    )}
                  </div>
                  <span className="text-xs px-2 py-1 bg-[var(--muted)] rounded-full">
                    {project.status.replace(/_/g, " ")}
                  </span>
                </div>
              </Link>
            ))}
            {projects.length === 0 && (
              <div className="text-center py-12">
                <FolderOpen size={40} className="mx-auto text-[var(--muted-foreground)] mb-3" />
                <p className="text-[var(--muted-foreground)]">
                  {debouncedSearch || statusFilter
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
