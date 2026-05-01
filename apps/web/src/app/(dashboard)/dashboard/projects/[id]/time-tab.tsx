"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import { formatDuration, formatHours } from "@/lib/format-duration";
import { Play, Plus, Trash2, Lock } from "lucide-react";
import { ManualEntryModal } from "./manual-entry-modal";

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
  const [modalOpen, setModalOpen] = useState<boolean>(false);

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
    try {
      await apiFetch("/time-entries/start", {
        method: "POST",
        body: JSON.stringify({ projectId }),
      });
      success("Timer started");
      load();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to start timer");
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
          <div className="flex gap-2">
            <button
              onClick={startTimer}
              className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)] transition-colors"
            >
              <Play size={14} /> Start timer
            </button>
            <button
              onClick={() => setModalOpen(true)}
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
                    {e.durationSec ? formatDuration(e.durationSec) : "running"}
                  </span>
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
              {!e.invoiceLineItemId && !isArchived && (
                <button
                  onClick={() => deleteEntry(e.id)}
                  className="p-1.5 text-[var(--muted-foreground)] hover:text-red-500 transition-colors shrink-0"
                  title="Delete"
                  aria-label="Delete entry"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <ManualEntryModal
          projectId={projectId}
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}
