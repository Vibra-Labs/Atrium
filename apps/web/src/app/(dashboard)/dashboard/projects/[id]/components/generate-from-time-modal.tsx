"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";

interface GenerateFromTimeModalProps {
  projectId: string;
  onClose: () => void;
  onCreated?: (invoiceId: string) => void;
}

interface GenerateInvoiceResponse {
  invoiceId: string;
}

export function GenerateFromTimeModal({
  projectId,
  onClose,
  onCreated,
}: GenerateFromTimeModalProps): React.ReactElement {
  const { success, error: showError } = useToast();
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [includeNonBillable, setIncludeNonBillable] = useState<boolean>(false);
  const [mergeEntries, setMergeEntries] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      const body: {
        projectId: string;
        from?: string;
        to?: string;
        includeNonBillable: boolean;
        mergeEntries: boolean;
      } = {
        projectId,
        from: from || undefined,
        to: to || undefined,
        includeNonBillable,
        mergeEntries,
      };
      const res = await apiFetch<GenerateInvoiceResponse>(
        "/time-entries/generate-invoice",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      success("Draft invoice created");
      onCreated?.(res.invoiceId);
      onClose();
    } catch (err) {
      console.error(err);
      showError(
        err instanceof Error ? err.message : "Failed to generate invoice",
      );
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
          <h3 className="text-lg font-semibold">Generate invoice from time</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-xs text-[var(--muted-foreground)]">
          Creates a draft invoice from this project&apos;s un-invoiced time
          entries. Optionally restrict to a date range.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">
              From
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">
              To
            </label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeNonBillable}
            onChange={(e) => setIncludeNonBillable(e.target.checked)}
          />
          Include non-billable entries
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={mergeEntries}
            onChange={(e) => setMergeEntries(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Merge into a single line item
            <span className="block text-xs text-[var(--muted-foreground)]">
              Combines all entries into one line per hourly rate.
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Generating…" : "Generate draft"}
          </button>
        </div>
      </form>
    </div>
  );
}
