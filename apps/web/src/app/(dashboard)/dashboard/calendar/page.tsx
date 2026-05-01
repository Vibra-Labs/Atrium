"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { ChevronLeft, ChevronRight } from "lucide-react";
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

export default function CalendarPage() {
  const { error: showError } = useToast();
  const [month, setMonth] = useState<Date>(() => new Date());
  const [view, setView] = useState<"month" | "agenda">("month");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<Set<CalendarEventType>>(() => new Set(ALL_TYPES));
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ProjectsResponse>("/projects?limit=200")
      .then((res) => setProjects(Array.isArray(res) ? res : res.data))
      .catch((err: unknown) => { console.error(err); });
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const from = toISODate(gridStart(month));
      const to = toISODate(gridEnd(month));
      const params = new URLSearchParams();
      params.set("from", from);
      params.set("to", to);
      if (projectId) params.set("projectId", projectId);
      const res = await apiFetch<CalendarEvent[]>(`/calendar?${params.toString()}`);
      setEvents(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load";
      setError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  }, [month, projectId, showError]);

  useEffect(() => { load(); }, [load]);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-sm">
          <button
            onClick={() => setView("month")}
            className={`px-3 py-1.5 ${view === "month" ? "bg-[var(--muted)]" : ""}`}
          >Month</button>
          <button
            onClick={() => setView("agenda")}
            className={`px-3 py-1.5 ${view === "agenda" ? "bg-[var(--muted)]" : ""}`}
          >Agenda</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth((m) => addMonths(m, -1))}
            className="p-1.5 rounded border border-[var(--border)]"
            aria-label="Previous month"
          ><ChevronLeft size={16} /></button>
          <div className="px-3 text-sm font-medium min-w-[140px] text-center">
            {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </div>
          <button
            onClick={() => setMonth((m) => addMonths(m, 1))}
            className="p-1.5 rounded border border-[var(--border)]"
            aria-label="Next month"
          ><ChevronRight size={16} /></button>
          <button
            onClick={() => setMonth(new Date())}
            className="ml-2 px-3 py-1.5 text-sm border border-[var(--border)] rounded"
          >Today</button>
        </div>

        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
        >
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <div className="flex items-center gap-3 text-sm">
          {ALL_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-1">
              <input type="checkbox" checked={typeFilter.has(t)} onChange={() => toggleType(t)} />
              {TYPE_LABEL[t]}
            </label>
          ))}
        </div>

        {typeFilter.has("task") && assigneeOptions.length > 0 && (
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
          >
            <option value="">All assignees</option>
            {assigneeOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </div>

      {error ? (
        <div className="border border-[var(--border)] rounded-lg p-6 text-center text-sm">
          <div className="text-red-600 mb-2">Failed to load</div>
          <button onClick={load} className="px-3 py-1.5 border border-[var(--border)] rounded">Retry</button>
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
