"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import { formatDuration, formatHours } from "@/lib/format-duration";
import { Play, Square, Plus, Trash2, Lock, Pencil } from "lucide-react";
import { ManualEntryModal, type EditableEntry } from "./manual-entry-modal";

type ModalState = { mode: "closed" } | { mode: "new" } | { mode: "edit"; entry: EditableEntry };

interface Entry {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  description: string | null;
  billable: boolean;
  invoiceLineItemId: string | null;
  user: { name: string };
  task: { id: string; title: string } | null;
}

interface EntryListResponse {
  data: Entry[];
}

interface TimeTabProps {
  projectId: string;
  isArchived?: boolean;
}

export function TimeTab({ projectId, isArchived }: TimeTabProps): React.ReactElement {
  const { success, error: showError } = useToast();
  const confirm = useConfirm();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  const [now, setNow] = useState<number>(() => Date.now());
  const [draftDescription, setDraftDescription] = useState<string>("");
  const [timerBusy, setTimerBusy] = useState<boolean>(false);

  const runningEntry = entries.find((e) => !e.endedAt);
  const hasRunning = !!runningEntry;
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await apiFetch<EntryListResponse>(
        `/time-entries?projectId=${projectId}&limit=200`,
      );
      setEntries(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

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

  async function stopTimer(): Promise<void> {
    if (timerBusy) return;
    setTimerBusy(true);
    try {
      await apiFetch("/time-entries/stop", { method: "POST" });
      success("Timer stopped");
      load();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to stop timer");
    } finally {
      setTimerBusy(false);
    }
  }

  async function saveRunningDescription(value: string): Promise<void> {
    if (!runningEntry) return;
    if ((runningEntry.description ?? "") === value) return;
    try {
      await apiFetch(`/time-entries/${runningEntry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ description: value || null }),
      });
      load();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to save description");
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
            {hasRunning && runningEntry ? (
              <>
                <input
                  key={runningEntry.id}
                  type="text"
                  defaultValue={runningEntry.description ?? ""}
                  onBlur={(e) => saveRunningDescription(e.target.value.trim())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  placeholder="What are you working on?"
                  className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm w-full sm:w-56"
                />
                <button
                  onClick={stopTimer}
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

      {loading ? (
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
                      : formatDuration((now - new Date(e.startedAt).getTime()) / 1000)}
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
    </div>
  );
}
