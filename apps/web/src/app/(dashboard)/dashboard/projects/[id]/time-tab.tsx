"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import { formatDuration, formatHours } from "@/lib/format-duration";
import {
  Play,
  Square,
  Plus,
  Trash2,
  Lock,
  Pencil,
  X,
  BookOpen,
  CheckCircle2,
  Clock3,
} from "lucide-react";
import { ManualEntryModal, type EditableEntry } from "./manual-entry-modal";

type ModalState = { mode: "closed" } | { mode: "new" } | { mode: "edit"; entry: EditableEntry };

interface JournalLog {
  id: string;
  timeEntryId: string;
  kind: string;
  text: string;
  taskId: string | null;
  actorType: string;
  createdAt: string;
  task?: { id: string; title: string } | null;
}

interface Entry {
  id: string;
  projectId?: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  description: string | null;
  billable: boolean;
  invoiceLineItemId: string | null;
  user: { name: string };
  task: { id: string; title: string } | null;
  logs?: JournalLog[];
}

interface RunningEntry extends Entry {
  organizationId: string;
  projectId: string;
  userId: string;
  hourlyRateCents: number | null;
  createdAt: string;
  updatedAt: string;
  project: { id: string; name: string };
  logs: JournalLog[];
}

interface TaskOption {
  id: string;
  title: string;
  status: string;
}

interface PendingCapture {
  id: string;
  projectId: string;
  taskId: string | null;
  label: string;
  completedByType: string;
  completedByName: string | null;
  completedAt: string;
  project: { id: string; name: string };
  task: { id: string; title: string } | null;
}

interface EntryListResponse {
  data: Entry[];
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface TimeTabProps {
  projectId: string;
  isArchived?: boolean;
}

function relativeTime(date: string, now: number): string {
  const diffSec = Math.max(0, Math.floor((now - new Date(date).getTime()) / 1000));
  if (diffSec < 30) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function journalSummary(logs: JournalLog[]): string {
  return logs
    .map((log) => log.text.trim())
    .filter(Boolean)
    .join("\n");
}

export function TimeTab({ projectId, isArchived }: TimeTabProps): React.ReactElement {
  const { success, error: showError } = useToast();
  const confirm = useConfirm();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [runningDetails, setRunningDetails] = useState<RunningEntry | null>(null);
  const [openTasks, setOpenTasks] = useState<TaskOption[]>([]);
  const [pendingCaptures, setPendingCaptures] = useState<PendingCapture[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  const [now, setNow] = useState<number>(() => Date.now());
  const [draftDescription, setDraftDescription] = useState<string>("");
  const [timerBusy, setTimerBusy] = useState<boolean>(false);
  const [journalDraft, setJournalDraft] = useState<string>("");
  const [journalBusy, setJournalBusy] = useState<boolean>(false);
  const [completeTaskId, setCompleteTaskId] = useState<string>("");
  const [stopPrompt, setStopPrompt] = useState<{ description: string } | null>(null);
  const [resolveCapture, setResolveCapture] = useState<PendingCapture | null>(null);

  const runningEntry = entries.find((e) => !e.endedAt) ?? null;
  const currentRunning = runningDetails?.projectId === projectId ? runningDetails : runningEntry;
  const runningLogs = runningDetails?.projectId === projectId ? runningDetails.logs : currentRunning?.logs ?? [];
  const hasRunning = !!currentRunning;

  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [entriesRes, runningRes, pendingRes, tasksRes] = await Promise.all([
        apiFetch<EntryListResponse>(`/time-entries?projectId=${projectId}&limit=200`),
        apiFetch<RunningEntry | null>("/time-entries/running"),
        apiFetch<PendingCapture[]>("/time-entries/pending-captures"),
        apiFetch<PaginatedResponse<TaskOption>>(`/tasks/project/${projectId}?page=1&limit=100&status=active`),
      ]);
      setEntries(entriesRes.data);
      setRunningDetails(runningRes?.projectId === projectId ? runningRes : null);
      setPendingCaptures(pendingRes.filter((capture) => capture.projectId === projectId));
      setOpenTasks(tasksRes.data.filter((task) => task.status !== "done" && task.status !== "cancelled"));
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Could not load time entries";
      setLoadError(msg);
      showError("Could not load time entries — try again");
    } finally {
      setLoading(false);
    }
  }, [projectId, showError]);

  useEffect(() => {
    load();
  }, [load]);

  async function startTimer(): Promise<void> {
    if (timerBusy) return;
    setTimerBusy(true);
    try {
      const running = await apiFetch<{
        id: string;
        project: { id: string; name: string };
      } | null>("/time-entries/running");
      if (running && running.project.id !== projectId) {
        const ok = await confirm({
          title: "Stop running timer?",
          message: `A timer is currently running on "${running.project.name}". Starting a new timer here will stop it.`,
          confirmLabel: "Stop and start",
        });
        if (!ok) return;
      }
      const description = draftDescription.trim();
      await apiFetch("/time-entries/start", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          ...(description ? { description } : {}),
        }),
      });
      setDraftDescription("");
      success("Timer started");
      load();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to start timer");
    } finally {
      setTimerBusy(false);
    }
  }

  async function stopTimer(description: string): Promise<void> {
    if (timerBusy || !currentRunning) return;
    setTimerBusy(true);
    try {
      const trimmed = description.trim();
      const current = currentRunning.description ?? "";
      if (trimmed !== current) {
        await apiFetch(`/time-entries/${currentRunning.id}`, {
          method: "PATCH",
          body: JSON.stringify({ description: trimmed || null }),
        });
      }
      await apiFetch("/time-entries/stop", { method: "POST" });
      setStopPrompt(null);
      success("Timer stopped");
      load();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to stop timer");
    } finally {
      setTimerBusy(false);
    }
  }

  async function saveRunningDescription(value: string): Promise<void> {
    if (!currentRunning) return;
    if ((currentRunning.description ?? "") === value) return;
    try {
      await apiFetch(`/time-entries/${currentRunning.id}`, {
        method: "PATCH",
        body: JSON.stringify({ description: value || null }),
      });
      load();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to save description");
    }
  }

  async function addJournalNote(): Promise<void> {
    if (!currentRunning || journalBusy) return;
    const text = journalDraft.trim();
    if (!text) return;
    setJournalBusy(true);
    try {
      await apiFetch(`/time-entries/${currentRunning.id}/logs`, {
        method: "POST",
        body: JSON.stringify({ kind: "note", text }),
      });
      setJournalDraft("");
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to add journal note");
    } finally {
      setJournalBusy(false);
    }
  }

  async function deleteJournalLog(logId: string): Promise<void> {
    const ok = await confirm({
      title: "Delete journal line?",
      message: "This removes the note from the current session journal.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/time-entries/logs/${logId}`, { method: "DELETE" });
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete journal line");
    }
  }

  async function completeTaskFromTimer(): Promise<void> {
    if (!completeTaskId) return;
    try {
      await apiFetch(`/tasks/${completeTaskId}`, {
        method: "PUT",
        body: JSON.stringify({ status: "done" }),
      });
      setCompleteTaskId("");
      success("Task completed and captured in the session journal");
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to complete task");
    }
  }

  async function deleteEntry(id: string): Promise<void> {
    const ok = await confirm({
      title: "Delete time entry?",
      message: "This cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/time-entries/${id}`, { method: "DELETE" });
      success("Entry deleted");
      load();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete entry");
    }
  }

  const totals = entries.reduce(
    (acc, e) => {
      const sec = e.durationSec ?? 0;
      acc.total += sec;
      if (e.billable) acc.billable += sec;
      return acc;
    },
    { total: 0, billable: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-4 text-sm">
          <div>
            <span className="text-[var(--muted-foreground)]">Total:</span>{" "}
            <span className="font-medium">{formatHours(totals.total)}h</span>
          </div>
          <div>
            <span className="text-[var(--muted-foreground)]">Billable:</span>{" "}
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              {formatHours(totals.billable)}h
            </span>
          </div>
        </div>
        {!isArchived && (
          <div className="flex gap-2 items-center flex-wrap">
            {hasRunning && currentRunning ? (
              <>
                <input
                  key={currentRunning.id}
                  type="text"
                  defaultValue={currentRunning.description ?? ""}
                  onBlur={(e) => saveRunningDescription(e.target.value.trim())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  placeholder="What are you working on?"
                  className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm w-full sm:w-56"
                />
                <button
                  onClick={() => setStopPrompt({ description: currentRunning.description ?? "" })}
                  disabled={timerBusy}
                  title="Stop timer"
                  className="flex items-center gap-1 rounded-lg border border-red-500 text-red-600 dark:text-red-400 px-3 py-1.5 text-sm hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  <Square size={14} /> Stop timer
                </button>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      startTimer();
                    }
                  }}
                  placeholder="What are you working on?"
                  className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm w-full sm:w-56"
                />
                <button
                  onClick={startTimer}
                  disabled={timerBusy}
                  className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
                >
                  <Play size={14} /> Start timer
                </button>
              </>
            )}
            <button
              onClick={() => setModal({ mode: "new" })}
              className="flex items-center gap-1 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              <Plus size={14} /> Add entry
            </button>
          </div>
        )}
      </div>

      {pendingCaptures.length > 0 && !isArchived && (
        <PendingCapturesPanel
          captures={pendingCaptures}
          onResolve={setResolveCapture}
          now={now}
        />
      )}

      {hasRunning && currentRunning && !isArchived && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <BookOpen size={15} /> Session journal
              </div>
              <div className="text-xs text-[var(--muted-foreground)]">
                Notes and completed tasks captured while this timer runs.
              </div>
            </div>
            <div className="text-xs text-[var(--muted-foreground)] font-mono">
              {formatDuration(Math.floor((now - new Date(currentRunning.startedAt).getTime()) / 1000))}
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={journalDraft}
              onChange={(e) => setJournalDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addJournalNote();
                }
              }}
              placeholder="Quick note…"
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            />
            <button
              onClick={addJournalNote}
              disabled={journalBusy || !journalDraft.trim()}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--muted)] disabled:opacity-50"
            >
              Add note
            </button>
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            <select
              value={completeTaskId}
              onChange={(e) => setCompleteTaskId(e.target.value)}
              className="min-w-[220px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="">Log completed task…</option>
              {openTasks.map((task) => (
                <option key={task.id} value={task.id}>{task.title}</option>
              ))}
            </select>
            <button
              onClick={completeTaskFromTimer}
              disabled={!completeTaskId}
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              title="Completes the task; the server capture hook writes the journal line."
            >
              <CheckCircle2 size={14} /> Complete
            </button>
          </div>

          {runningLogs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted-foreground)]">
              No journal lines yet. Add a note or complete a task while the timer is running.
            </div>
          ) : (
            <div className="space-y-2">
              {runningLogs.map((log) => (
                <div key={log.id} className="flex items-start justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs rounded-full bg-[var(--muted)] px-2 py-0.5 text-[var(--muted-foreground)]">
                        {log.kind === "task_done" ? "task" : log.kind}
                      </span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {relativeTime(log.createdAt, now)}{log.actorType === "agent" ? " · agent" : ""}
                      </span>
                    </div>
                    <div className="mt-1 text-[var(--foreground)] break-words">{log.text}</div>
                  </div>
                  {log.kind !== "task_done" && (
                    <button
                      onClick={() => deleteJournalLog(log.id)}
                      className="p-1.5 text-[var(--muted-foreground)] hover:text-red-500 transition-colors"
                      title="Delete journal line"
                      aria-label="Delete journal line"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loadError ? (
        <div className="border border-[var(--border)] rounded-lg p-6 text-center text-sm">
          <div className="text-red-600 mb-2">Could not load time entries</div>
          <button
            onClick={() => load()}
            className="px-3 py-1.5 border border-[var(--border)] rounded"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-sm text-[var(--muted-foreground)] text-center py-8">
          No time logged on this project yet.
        </div>
      ) : (
        <div className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
          {entries.map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-2 p-3 text-sm"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono">
                    {e.endedAt
                      ? formatDuration(e.durationSec ?? 0)
                      : formatDuration(Math.floor((now - new Date(e.startedAt).getTime()) / 1000))}
                  </span>
                  {!e.endedAt && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      running
                    </span>
                  )}
                  {e.billable && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      billable
                    </span>
                  )}
                  {e.invoiceLineItemId && (
                    <Lock
                      size={12}
                      className="text-[var(--muted-foreground)]"
                      aria-label="Invoiced (locked)"
                    />
                  )}
                </div>
                <div className="text-xs text-[var(--muted-foreground)] truncate">
                  {new Date(e.startedAt).toLocaleString()} · {e.user.name}
                  {e.task && ` · ${e.task.title}`}
                  {e.description && ` · ${e.description}`}
                </div>
              </div>
              {!e.invoiceLineItemId && !isArchived && e.endedAt && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setModal({
                      mode: "edit",
                      entry: {
                        id: e.id,
                        startedAt: e.startedAt,
                        endedAt: e.endedAt,
                        description: e.description,
                        billable: e.billable,
                      },
                    })}
                    className="p-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                    title="Edit"
                    aria-label="Edit entry"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => deleteEntry(e.id)}
                    className="p-1.5 text-[var(--muted-foreground)] hover:text-red-500 transition-colors"
                    title="Delete"
                    aria-label="Delete entry"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal.mode !== "closed" && (
        <ManualEntryModal
          projectId={projectId}
          entry={modal.mode === "edit" ? modal.entry : undefined}
          onClose={() => setModal({ mode: "closed" })}
          onSaved={() => {
            setModal({ mode: "closed" });
            load();
          }}
        />
      )}

      {stopPrompt && currentRunning && (
        <StopTimerModal
          elapsedSec={Math.floor((now - new Date(currentRunning.startedAt).getTime()) / 1000)}
          initialDescription={stopPrompt.description}
          logs={runningLogs}
          busy={timerBusy}
          onCancel={() => setStopPrompt(null)}
          onStop={(desc) => stopTimer(desc)}
        />
      )}

      {resolveCapture && (
        <ResolvePendingCaptureModal
          capture={resolveCapture}
          onCancel={() => setResolveCapture(null)}
          onResolve={async (durationSec, billable) => {
            await apiFetch(`/time-entries/pending-captures/${resolveCapture.id}/resolve`, {
              method: "POST",
              body: JSON.stringify({ durationSec, billable }),
            });
            setResolveCapture(null);
            success("Time capture resolved");
            await load();
          }}
        />
      )}
    </div>
  );
}

function PendingCapturesPanel({
  captures,
  onResolve,
  now,
}: {
  captures: PendingCapture[];
  onResolve: (capture: PendingCapture) => void;
  now: number;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-amber-300/70 bg-amber-50/70 dark:bg-amber-950/20 dark:border-amber-800 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
          <Clock3 size={15} /> {captures.length} completion{captures.length === 1 ? "" : "s"} logged without a timer
        </div>
        <div className="text-xs text-amber-800/80 dark:text-amber-200/80">Add a duration to back-fill billable time.</div>
      </div>
      <div className="space-y-2">
        {captures.map((capture) => (
          <div key={capture.id} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--background)] border border-[var(--border)] px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{capture.label}</div>
              <div className="text-xs text-[var(--muted-foreground)]">
                {relativeTime(capture.completedAt, now)}{capture.completedByName ? ` · ${capture.completedByName}` : ""}
              </div>
            </div>
            <button
              onClick={() => onResolve(capture)}
              className="shrink-0 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              Resolve
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

interface StopTimerModalProps {
  elapsedSec: number;
  initialDescription: string;
  logs: JournalLog[];
  busy: boolean;
  onCancel: () => void;
  onStop: (description: string) => void;
}

function StopTimerModal({
  elapsedSec,
  initialDescription,
  logs,
  busy,
  onCancel,
  onStop,
}: StopTimerModalProps): React.ReactElement {
  const [description, setDescription] = useState<string>(initialDescription);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const summary = journalSummary(logs);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    onStop(description);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        onSubmit={submit}
        className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-lg p-6 space-y-4"
      >
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold">Stop timer</h3>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="text-sm text-[var(--muted-foreground)]">
          Elapsed: <span className="font-mono text-[var(--foreground)]">{formatDuration(elapsedSec)}</span>
        </div>
        {logs.length > 0 && (
          <div className="rounded-lg border border-[var(--border)] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-[var(--muted-foreground)]">Session journal summary</div>
              <button
                type="button"
                onClick={() => setDescription(summary.slice(0, 1000))}
                className="text-xs rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--muted)]"
              >
                Use journal as description
              </button>
            </div>
            <div className="max-h-28 overflow-auto text-xs text-[var(--muted-foreground)] whitespace-pre-wrap">
              {summary}
            </div>
          </div>
        )}
        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-1">
            Description
          </label>
          <textarea
            ref={inputRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What did you work on?"
            rows={3}
            maxLength={1000}
            className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "Stopping…" : "Stop"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ResolvePendingCaptureModal({
  capture,
  onCancel,
  onResolve,
}: {
  capture: PendingCapture;
  onCancel: () => void;
  onResolve: (durationSec: number, billable: boolean) => Promise<void>;
}): React.ReactElement {
  const [durationSec, setDurationSec] = useState<number>(1800);
  const [customMinutes, setCustomMinutes] = useState<string>("");
  const [billable, setBillable] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const chips = [
    { label: "15m", value: 15 * 60 },
    { label: "30m", value: 30 * 60 },
    { label: "1h", value: 60 * 60 },
    { label: "2h", value: 2 * 60 * 60 },
  ];

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const custom = customMinutes.trim() ? Math.round(Number(customMinutes) * 60) : null;
    const seconds = custom && custom > 0 ? custom : durationSec;
    if (!seconds || seconds < 1) return;
    setBusy(true);
    try {
      await onResolve(seconds, billable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form onSubmit={submit} className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Log completed task</h3>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">{capture.label}</p>
          </div>
          <button type="button" onClick={onCancel} className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-2">Duration</label>
          <div className="flex gap-2 flex-wrap">
            {chips.map((chip) => (
              <button
                key={chip.value}
                type="button"
                onClick={() => {
                  setDurationSec(chip.value);
                  setCustomMinutes("");
                }}
                className={`rounded-full px-3 py-1.5 text-sm border transition-colors ${durationSec === chip.value && !customMinutes ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border)] hover:bg-[var(--muted)]"}`}
              >
                {chip.label}
              </button>
            ))}
            <input
              type="number"
              min="1"
              step="1"
              value={customMinutes}
              onChange={(e) => setCustomMinutes(e.target.value)}
              placeholder="Custom min"
              className="w-32 rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={billable}
            onChange={(e) => setBillable(e.target.checked)}
            className="rounded border-[var(--border)]"
          />
          Billable
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Create time entry"}
          </button>
        </div>
      </form>
    </div>
  );
}
