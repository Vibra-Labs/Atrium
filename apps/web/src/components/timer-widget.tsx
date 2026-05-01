"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Play, Square, Clock } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { formatDuration } from "@/lib/format-duration";

interface RunningEntry {
  id: string;
  startedAt: string;
  description: string | null;
  project: { id: string; name: string };
  task: { id: string; title: string } | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface ProjectsResponse {
  data: ProjectOption[];
}

export function TimerWidget(): React.ReactElement {
  const { success, error: showError } = useToast();
  const [running, setRunning] = useState<RunningEntry | null>(null);
  const [tick, setTick] = useState<number>(0);
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [description, setDescription] = useState<string>("");

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const r = await apiFetch<RunningEntry | null>("/time-entries/running");
      setRunning(r);
    } catch (err) {
      console.error(err);
      setRunning(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    const onFocus = (): void => {
      refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!pickerOpen) return;
    apiFetch<ProjectsResponse | ProjectOption[]>("/projects?limit=100")
      .then((res) => {
        const list: ProjectOption[] = Array.isArray(res) ? res : res.data;
        setProjects(list);
        if (list[0]) setProjectId(list[0].id);
      })
      .catch((err) => console.error(err));
  }, [pickerOpen]);

  // Reference `tick` so this component re-renders every second while running,
  // keeping the elapsed display fresh.
  void tick;
  const elapsed = running
    ? Math.floor(
        (Date.now() - new Date(running.startedAt).getTime()) / 1000,
      )
    : 0;

  async function start(): Promise<void> {
    if (!projectId) return;
    try {
      await apiFetch("/time-entries/start", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          description: description || undefined,
        }),
      });
      success("Timer started");
      setPickerOpen(false);
      setDescription("");
      refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to start timer");
    }
  }

  async function stop(): Promise<void> {
    try {
      await apiFetch("/time-entries/stop", { method: "POST" });
      success("Timer stopped");
      refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to stop timer");
    }
  }

  if (running) {
    return (
      <div className="flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5">
        <Link
          href={`/dashboard/projects/${running.project.id}?tab=time`}
          className="flex items-center gap-2 text-sm"
        >
          <Clock size={14} className="text-emerald-700" />
          <span className="font-medium text-emerald-900 truncate max-w-[140px]">
            {running.project.name}
          </span>
          <span className="font-mono text-emerald-800">
            {formatDuration(elapsed)}
          </span>
        </Link>
        <button
          onClick={stop}
          className="text-emerald-700 hover:text-emerald-900"
          title="Stop timer"
        >
          <Square size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setPickerOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
      >
        <Play size={14} />
        Start timer
      </button>
      {pickerOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-lg p-3 z-50 space-y-2">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="What are you working on? (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setPickerOpen(false)}
              className="px-3 py-1.5 text-sm text-[var(--muted-foreground)]"
            >
              Cancel
            </button>
            <button
              onClick={start}
              disabled={!projectId}
              className="rounded bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Start
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
