"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { ChevronLeft, ChevronRight, ChevronDown, SlidersHorizontal } from "lucide-react";
import {
  ALL_TYPES,
  addMonths,
  gridStart,
  gridEnd,
  toISODate,
  type CalendarEvent,
  type CalendarEventType,
} from "./types";
import { MonthGrid } from "./month-grid";
import { AgendaList } from "./agenda-list";

interface ProjectOption { id: string; name: string }
type ProjectsResponse = { data: ProjectOption[] } | ProjectOption[];

const TYPE_LABEL: Record<CalendarEventType, string> = {
  task: "Tasks",
  project_start: "Project starts",
  project_end: "Project ends",
  invoice_due: "Invoices",
};

export default function CalendarPage(): React.ReactElement {
  const [month, setMonth] = useState<Date>(() => new Date());
  const [view, setView] = useState<"month" | "agenda">("month");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<Set<CalendarEventType>>(() => new Set(ALL_TYPES));
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [filterOpen, setFilterOpen] = useState<boolean>(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const filterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pickerOpen && !filterOpen) return;
    function onClick(e: MouseEvent): void {
      if (pickerOpen && pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
      if (filterOpen && filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        setPickerOpen(false);
        setFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen, filterOpen]);

  useEffect(() => {
    apiFetch<ProjectsResponse>("/projects?limit=100")
      .then((res) => setProjects(Array.isArray(res) ? res : res.data))
      .catch((err: unknown) => { console.error(err); });
  }, []);

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const from = toISODate(gridStart(month));
      const to = toISODate(gridEnd(month));
      const params = new URLSearchParams();
      params.set("from", from);
      params.set("to", to);
      if (projectId) params.set("projectId", projectId);
      const res = await apiFetch<CalendarEvent[]>(`/calendar?${params.toString()}`, { signal });
      if (signal?.aborted) return;
      setEvents(res);
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
      const msg = err instanceof Error ? err.message : "Failed to load";
      setError(msg);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [month, projectId]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const filtered = useMemo<CalendarEvent[]>(() => {
    return events.filter((e) => {
      if (!typeFilter.has(e.type)) return false;
      if (assigneeId && e.type === "task" && e.assigneeId !== assigneeId) return false;
      return true;
    });
  }, [events, typeFilter, assigneeId]);

  const assigneeOptions = useMemo<{ id: string; name: string }[]>(() => {
    const seen = new Map<string, string>();
    for (const e of events) {
      if (e.type === "task" && e.assigneeId && e.assigneeName) {
        seen.set(e.assigneeId, e.assigneeName);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [events]);

  function toggleType(t: CalendarEventType): void {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  const allTypesActive = typeFilter.size === ALL_TYPES.length;
  const filtersActive = !allTypesActive || !!assigneeId;
  const filterCount = (allTypesActive ? 0 : 1) + (assigneeId ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
        {/* Left cluster: month nav + picker + today */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth((m) => addMonths(m, -1))}
            aria-label="Previous month"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          ><ChevronLeft size={15} /></button>

          <div ref={pickerRef} className="relative">
            <button
              onClick={() => setPickerOpen((v) => !v)}
              className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-sm font-medium hover:bg-[var(--muted)] transition-colors"
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
            >
              {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              <ChevronDown size={12} className="text-[var(--muted-foreground)]" />
            </button>
            {pickerOpen && (
              <div className="absolute z-30 left-1/2 -translate-x-1/2 mt-1.5 w-72 rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setMonth((m) => new Date(m.getFullYear() - 1, m.getMonth(), 1))}
                    className="p-1 rounded hover:bg-[var(--muted)]"
                    aria-label="Previous year"
                  ><ChevronLeft size={14} /></button>
                  <div className="text-sm font-medium">{month.getFullYear()}</div>
                  <button
                    onClick={() => setMonth((m) => new Date(m.getFullYear() + 1, m.getMonth(), 1))}
                    className="p-1 rounded hover:bg-[var(--muted)]"
                    aria-label="Next year"
                  ><ChevronRight size={14} /></button>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {Array.from({ length: 12 }, (_, i) => {
                    const label = new Date(2000, i, 1).toLocaleDateString(undefined, { month: "short" });
                    const isCurrent = i === month.getMonth();
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          setMonth((m) => new Date(m.getFullYear(), i, 1));
                          setPickerOpen(false);
                        }}
                        className={`text-sm py-1.5 rounded ${isCurrent ? "bg-[var(--primary)] text-white" : "hover:bg-[var(--muted)]"}`}
                      >{label}</button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setMonth((m) => addMonths(m, 1))}
            aria-label="Next month"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          ><ChevronRight size={15} /></button>

          <button
            onClick={() => setMonth(new Date())}
            className="ml-1 h-7 px-2.5 text-xs font-medium rounded-md border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >Today</button>
        </div>

        {/* Right cluster: view + project + filter */}
        <div className="flex items-center gap-2">
          {/* Segmented view switcher */}
          <div className="flex items-center h-7 p-0.5 rounded-md bg-[var(--muted)] gap-0.5">
            {(["month", "agenda"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`h-6 px-2.5 text-xs font-medium rounded transition-colors capitalize ${view === v ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
              >{v}</button>
            ))}
          </div>

          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="h-7 pl-2.5 pr-7 text-xs rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer"
          >
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {/* Filter popover */}
          <div ref={filterRef} className="relative">
            <button
              onClick={() => setFilterOpen((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={filterOpen}
              className={`h-7 px-2.5 inline-flex items-center gap-1.5 text-xs rounded-md border transition-colors ${filtersActive ? "border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/10" : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"}`}
            >
              <SlidersHorizontal size={12} />
              {filtersActive ? `Filter · ${filterCount}` : "Filter"}
            </button>
            {filterOpen && (
              <div className="absolute z-30 right-0 top-full mt-1.5 w-60 rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-lg p-3 space-y-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5">Event types</div>
                  <div className="space-y-1">
                    {ALL_TYPES.map((t) => (
                      <label key={t} className="flex items-center gap-2 text-sm cursor-pointer text-[var(--foreground)] hover:text-[var(--foreground)]">
                        <input
                          type="checkbox"
                          checked={typeFilter.has(t)}
                          onChange={() => toggleType(t)}
                          className="accent-[var(--primary)] w-3.5 h-3.5"
                        />
                        {TYPE_LABEL[t]}
                      </label>
                    ))}
                  </div>
                </div>

                {assigneeOptions.length > 0 && typeFilter.has("task") && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5">Assignee</div>
                    <select
                      value={assigneeId}
                      onChange={(e) => setAssigneeId(e.target.value)}
                      className="w-full h-7 pl-2 pr-6 text-xs rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
                    >
                      <option value="">All assignees</option>
                      {assigneeOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                )}

                {filtersActive && (
                  <button
                    onClick={() => {
                      setTypeFilter(new Set(ALL_TYPES));
                      setAssigneeId("");
                    }}
                    className="w-full text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] py-1 border-t border-[var(--border)] pt-2"
                  >Reset filters</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <div className="border border-[var(--border)] rounded-lg p-6 text-center text-sm">
          <div className="text-red-600 mb-2">Failed to load</div>
          <button onClick={() => load()} className="px-3 py-1.5 border border-[var(--border)] rounded">Retry</button>
        </div>
      ) : loading ? (
        <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
      ) : view === "month" ? (
        <MonthGrid month={month} events={filtered} />
      ) : (
        <AgendaList events={filtered} />
      )}
    </div>
  );
}
