"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { Search, FolderOpen, CheckSquare, FileText, Users, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useDebounce } from "@/hooks/use-debounce";

const MIN_QUERY_LENGTH = 2;

interface ProjectResult {
  id: string;
  name: string;
  description: string | null;
  status: string;
}

interface TaskResult {
  id: string;
  title: string;
  description: string | null;
  projectId: string;
  project: { id: string; name: string };
}

interface FileResult {
  id: string;
  filename: string;
  projectId: string;
  project: { id: string; name: string };
}

interface ClientResult {
  id: string;
  userId: string;
  company: string | null;
  user: { id: string; name: string; email: string };
}

interface SearchResults {
  projects: ProjectResult[];
  tasks: TaskResult[];
  files: FileResult[];
  clients: ClientResult[];
}

interface FlatItem {
  key: string;
  href: string;
  label: string;
  sublabel?: string;
}

function buildFlatItems(results: SearchResults): FlatItem[] {
  const items: FlatItem[] = [];
  for (const p of results.projects) {
    items.push({ key: `project-${p.id}`, href: `/dashboard/projects/${p.id}`, label: p.name, sublabel: p.status });
  }
  for (const t of results.tasks) {
    items.push({ key: `task-${t.id}`, href: `/dashboard/projects/${t.projectId}`, label: t.title, sublabel: t.project.name });
  }
  for (const f of results.files) {
    items.push({ key: `file-${f.id}`, href: `/dashboard/projects/${f.projectId}`, label: f.filename, sublabel: f.project.name });
  }
  for (const c of results.clients) {
    items.push({ key: `client-${c.id}`, href: `/dashboard/clients`, label: c.user.name, sublabel: c.company || c.user.email });
  }
  return items;
}

export function GlobalSearch({ iconOnly = false }: { iconOnly?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults(null);
      setActiveIndex(-1);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (debouncedQuery.length < MIN_QUERY_LENGTH) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetch<SearchResults>(`/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then((data) => { if (!cancelled) { setResults(data); setActiveIndex(-1); } })
      .catch(() => { if (!cancelled) setResults(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  const flatItems = useMemo(() => (results ? buildFlatItems(results) : []), [results]);
  const indexByKey = useMemo(() => new Map(flatItems.map((item, i) => [item.key, i])), [flatItems]);

  useEffect(() => {
    itemRefs.current = [];
  }, [flatItems]);

  useEffect(() => {
    if (activeIndex >= 0) {
      itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const close = () => setOpen(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!flatItems.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      itemRefs.current[activeIndex]?.click();
    }
  };

  const { projects = [], tasks = [], files = [], clients = [] } = results ?? {};
  const hasResults = projects.length > 0 || tasks.length > 0 || files.length > 0 || clients.length > 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open search (Cmd+K)"
        className={
          iconOnly
            ? "p-1.5 rounded-lg hover:bg-[var(--muted)] transition-colors"
            : "flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[var(--muted-foreground)] bg-[var(--muted)] hover:bg-[var(--muted)]/80 border border-[var(--border)] rounded-lg transition-colors"
        }
      >
        <Search size={iconOnly ? 18 : 14} className="shrink-0" />
        {!iconOnly && (
          <>
            <span className="flex-1 text-left truncate">Search...</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium border border-[var(--border)] rounded bg-[var(--background)]">
              <span>⌘</span>K
            </kbd>
          </>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[10vh] px-4"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div
            className="w-full max-w-xl bg-[var(--background)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
              <Search size={16} className="text-[var(--muted-foreground)] shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search projects, tasks, files, people..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
                aria-label="Search query"
              />
              {loading && <Loader2 size={16} className="text-[var(--muted-foreground)] animate-spin shrink-0" />}
            </div>

            <div className="flex-1 overflow-y-auto">
              {query.length < MIN_QUERY_LENGTH && (
                <p className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                  Type at least {MIN_QUERY_LENGTH} characters to search
                </p>
              )}

              {query.length >= MIN_QUERY_LENGTH && !loading && !hasResults && results !== null && (
                <p className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                  No results found
                </p>
              )}

              {hasResults && (
                <div className="py-2">
                  {projects.length > 0 && (
                    <Section icon={<FolderOpen size={13} />} label="Projects">
                      {projects.map((p) => {
                        const idx = indexByKey.get(`project-${p.id}`)!;
                        return (
                          <ResultRow
                            key={p.id}
                            href={`/dashboard/projects/${p.id}`}
                            label={p.name}
                            sublabel={p.status}
                            active={activeIndex === idx}
                            ref={(el) => { itemRefs.current[idx] = el; }}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={close}
                          />
                        );
                      })}
                    </Section>
                  )}

                  {tasks.length > 0 && (
                    <Section icon={<CheckSquare size={13} />} label="Tasks">
                      {tasks.map((t) => {
                        const idx = indexByKey.get(`task-${t.id}`)!;
                        return (
                          <ResultRow
                            key={t.id}
                            href={`/dashboard/projects/${t.projectId}`}
                            label={t.title}
                            sublabel={t.project.name}
                            active={activeIndex === idx}
                            ref={(el) => { itemRefs.current[idx] = el; }}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={close}
                          />
                        );
                      })}
                    </Section>
                  )}

                  {files.length > 0 && (
                    <Section icon={<FileText size={13} />} label="Files">
                      {files.map((f) => {
                        const idx = indexByKey.get(`file-${f.id}`)!;
                        return (
                          <ResultRow
                            key={f.id}
                            href={`/dashboard/projects/${f.projectId}`}
                            label={f.filename}
                            sublabel={f.project.name}
                            active={activeIndex === idx}
                            ref={(el) => { itemRefs.current[idx] = el; }}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={close}
                          />
                        );
                      })}
                    </Section>
                  )}

                  {clients.length > 0 && (
                    <Section icon={<Users size={13} />} label="People">
                      {clients.map((c) => {
                        const idx = indexByKey.get(`client-${c.id}`)!;
                        return (
                          <ResultRow
                            key={c.id}
                            href="/dashboard/clients"
                            label={c.user.name}
                            sublabel={c.company || c.user.email}
                            active={activeIndex === idx}
                            ref={(el) => { itemRefs.current[idx] = el; }}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={close}
                          />
                        );
                      })}
                    </Section>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

const ResultRow = ({
  href,
  label,
  sublabel,
  active,
  onMouseEnter,
  onClick,
  ref: forwardedRef,
}: {
  href: string;
  label: string;
  sublabel?: string;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
  ref?: React.RefCallback<HTMLAnchorElement>;
}) => {
  return (
    <Link
      href={href}
      ref={forwardedRef}
      className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
        active ? "bg-[var(--primary)] text-white" : "hover:bg-[var(--muted)]"
      }`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="flex-1 truncate font-medium">{label}</span>
      {sublabel && (
        <span className={`shrink-0 text-xs truncate max-w-[140px] ${active ? "text-white/70" : "text-[var(--muted-foreground)]"}`}>
          {sublabel}
        </span>
      )}
    </Link>
  );
};
