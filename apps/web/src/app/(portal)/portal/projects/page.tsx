"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { Pagination } from "@/components/pagination";
import { ProjectCardSkeleton } from "@/components/skeletons";
import { Search, FolderOpen } from "lucide-react";

interface Project {
  id: string;
  name: string;
  status: string;
  description?: string;
  pendingApprovals?: number;
  taskCount: number;
  completedTaskCount: number;
  lastActivityAt: string;
}

function ProjectProgress({ done, total }: { done: number; total: number }): React.ReactElement {
  const percent: number = Math.round((done / total) * 100);
  return (
    <div className="mt-3 flex items-center gap-3" data-testid="project-progress">
      <div
        className="h-1.5 flex-1 max-w-xs overflow-hidden rounded-full bg-[var(--muted)]"
        role="progressbar"
        aria-label="Project progress"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs text-[var(--muted-foreground)]">
        {done} of {total} tasks done
      </span>
    </div>
  );
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export default function PortalProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageState, setPageState] = useState({ page: 1, filterKey: "" });
  const requestId = useRef(0);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  // The page belongs to the search it was chosen under, so a new search falls back to page 1.
  const page: number = pageState.filterKey === debouncedSearch ? pageState.page : 1;
  const setPage = (next: number): void => setPageState({ page: next, filterKey: debouncedSearch });

  const loadProjects = useCallback(async () => {
    const myRequest: number = ++requestId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await apiFetch<PaginatedResponse<Project>>(
        `/projects/mine?${params}`,
      );
      if (myRequest !== requestId.current) return;
      setProjects(res.data);
      setTotalPages(res.meta.totalPages);
    } catch (err) {
      if (myRequest !== requestId.current) return;
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      if (myRequest === requestId.current) setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Your Projects</h1>

      {error && (
        <div className="mb-6 p-4 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
      )}

      <div className="mb-4">
        <div className="relative w-full sm:max-w-sm">
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
                href={`/portal/projects/${project.id}`}
                className="block p-4 border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-medium">{project.name}</h3>
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                    Updated {formatRelativeTime(project.lastActivityAt)}
                  </span>
                </div>
                {project.description && (
                  <p className="text-sm text-[var(--muted-foreground)] mt-1">
                    {project.description}
                  </p>
                )}
                <span className="inline-block mt-2 text-xs px-2 py-1 bg-[var(--muted)] rounded-full">
                  {project.status.replace(/_/g, " ")}
                </span>
                {(project.pendingApprovals ?? 0) > 0 && (
                  <span className="inline-block mt-2 ml-2 text-xs px-2 py-1 rounded-full font-medium bg-amber-100 text-amber-800" data-testid="to-review-chip">
                    {project.pendingApprovals} to review
                  </span>
                )}
                {project.taskCount > 0 && (
                  <ProjectProgress done={project.completedTaskCount} total={project.taskCount} />
                )}
              </Link>
            ))}
            {projects.length === 0 && (
              <div className="text-center py-12">
                <FolderOpen size={40} className="mx-auto text-[var(--muted-foreground)] mb-3" />
                <p className="text-[var(--muted-foreground)]">
                  {debouncedSearch
                    ? "No projects match your search."
                    : "No projects assigned to you yet."}
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
