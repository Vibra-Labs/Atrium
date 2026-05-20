"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import { formatDuration, formatHours } from "@/lib/format-duration";
import { Play, Square, Plus, Trash2, Lock, Pencil, X } from "lucide-react";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  const [now, setNow] = useState<number>(() => Date.now());
  const [draftDescription, setDraftDescription] = useState<string>("");
  const [timerBusy, setTimerBusy] = useState<boolean>(false);
  const [stopPrompt, setStopPrompt] = useState<{ description: string } | null>(null);

  const runningEntry = entries.find((e) => !e.endedAt);
  const hasRunning = !!runningEntry;
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch<EntryListResponse>(
        `/time-entries?projectId=${projectId}&limit=200`,
      );
      setEntries(res.data);
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
    if (timerBusy || !runningEntry) return;
    setTimerBusy(true);
    try {
      const trimmed = description.trim();
      const current = runningEntry.description ?? "";
      if (trimmed !== current) {
        await apiFetch(`/time-entries/${runningEntry.id}`, {
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
                  onClick={() => setStopPrompt({ description: runningEntry.description ?? "" })}
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

      {stopPrompt && runningEntry && (
        <StopTimerModal
          elapsedSec={Math.floor((now - new Date(runningEntry.startedAt).getTime()) / 1000)}
          initialDescription={stopPrompt.description}
          busy={timerBusy}
          onCancel={() => setStopPrompt(null)}
          onStop={(desc) => stopTimer(desc)}
        />
      )}
    </div>
  );
}

interface StopTimerModalProps {
  elapsedSec: number;
  initialDescription: string;
  busy: boolean;
  onCancel: () => void;
  onStop: (description: string) => void;
}

function StopTimerModal({
  elapsedSec,
  initialDescription,
  busy,
  onCancel,
  onStop,
}: StopTimerModalProps): React.ReactElement {
  const [description, setDescription] = useState<string>(initialDescription);
  const inputRef = useRef<HTMLInputElement>(null);

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
        className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-md p-6 space-y-4"
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
        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-1">
            Description
          </label>
          <input
            ref={inputRef}
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What did you work on?"
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
