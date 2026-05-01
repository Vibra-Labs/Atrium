"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { X } from "lucide-react";

interface ManualEntryModalProps {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}

export function ManualEntryModal({
  projectId,
  onClose,
  onCreated,
}: ManualEntryModalProps): React.ReactElement {
  const { error: showError } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState<string>(today);
  const [start, setStart] = useState<string>("09:00");
  const [end, setEnd] = useState<string>("10:00");
  const [description, setDescription] = useState<string>("");
  const [billable, setBillable] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      const startedAt = new Date(`${date}T${start}:00`).toISOString();
      const endedAt = new Date(`${date}T${end}:00`).toISOString();
      await apiFetch("/time-entries", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          startedAt,
          endedAt,
          description: description || undefined,
          billable,
        }),
      });
      onCreated();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to create entry");
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
          <h3 className="text-lg font-semibold">Add time entry</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-1">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">
              Start
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
              End
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
