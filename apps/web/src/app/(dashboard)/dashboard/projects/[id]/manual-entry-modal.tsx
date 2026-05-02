"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { X } from "lucide-react";

export interface EditableEntry {
  id: string;
  startedAt: string;
  endedAt: string | null;
  description: string | null;
  billable: boolean;
}

interface ManualEntryModalProps {
  projectId: string;
  entry?: EditableEntry;
  onClose: () => void;
  onSaved: () => void;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function localDateParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { date, time };
}

export function ManualEntryModal({
  projectId,
  entry,
  onClose,
  onSaved,
}: ManualEntryModalProps): React.ReactElement {
  const { error: showError } = useToast();
  const isEdit = !!entry;

  const initialStart = entry
    ? localDateParts(entry.startedAt)
    : { date: new Date().toISOString().slice(0, 10), time: "09:00" };
  const initialEnd = entry?.endedAt
    ? localDateParts(entry.endedAt)
    : { date: initialStart.date, time: "10:00" };

  const [startDate, setStartDate] = useState<string>(initialStart.date);
  const [endDate, setEndDate] = useState<string>(initialEnd.date);
  const [start, setStart] = useState<string>(initialStart.time);
  const [end, setEnd] = useState<string>(initialEnd.time);
  const [description, setDescription] = useState<string>(entry?.description ?? "");
  const [billable, setBillable] = useState<boolean>(entry?.billable ?? true);
  const [busy, setBusy] = useState<boolean>(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const startedAt = new Date(`${startDate}T${start}:00`);
    const endedAt = new Date(`${endDate}T${end}:00`);
    if (endedAt.getTime() <= startedAt.getTime()) {
      showError("End must be after start");
      return;
    }
    setBusy(true);
    try {
      if (isEdit && entry) {
        await apiFetch(`/time-entries/${entry.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            description: description || null,
            billable,
          }),
        });
      } else {
        await apiFetch("/time-entries", {
          method: "POST",
          body: JSON.stringify({
            projectId,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            description: description || undefined,
            billable,
          }),
        });
      }
      onSaved();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to save entry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-md p-6 space-y-4"
      >
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold">{isEdit ? "Edit time entry" : "Add time entry"}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">
              Start date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (endDate < e.target.value) setEndDate(e.target.value);
              }}
              required
              className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">
              End date
            </label>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
              className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">
              Start time
            </label>
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
              className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">
              End time
            </label>
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
              className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-1">
            Description
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What did you work on?"
            className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={billable}
            onChange={(e) => setBillable(e.target.checked)}
          />
          Billable
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
