"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { IMPORT_FIELDS, autoMatch } from "@/lib/contact-fields";
import type { ImportField } from "@/lib/contact-fields";
import { ImportReview, RowNotes } from "./import-review";
import type { ImportCheck, RowNote } from "./import-review";

interface Preview {
  headers: string[];
  rows: string[][];
  total: number;
}

interface ImportResult {
  created: number;
  skipped: RowNote[];
  /** Rows that were imported with something left out (e.g. a social link that isn't a URL). */
  warnings: RowNote[];
}

interface Props {
  onClose: () => void;
  onImported: () => void;
}

export function ImportContactsModal({ onClose, onImported }: Props) {
  const { error: showError } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, ImportField>>({});
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(f: File): Promise<void> {
    setFile(f);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await apiFetch<Preview>("/contacts/import/preview", { method: "POST", body: form });
      setPreview(res);
      setMapping(Object.fromEntries(res.headers.map((h) => [h, autoMatch(h)])));
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Could not read file");
      setFile(null);
    } finally {
      setBusy(false);
    }
  }

  function mappedFile(): FormData {
    const form = new FormData();
    if (file) form.append("file", file);
    form.append("mapping", JSON.stringify(mapping));
    return form;
  }

  /** Dry run: shows what the import will create before anything is written. */
  async function review(): Promise<void> {
    setBusy(true);
    try {
      setCheck(await apiFetch<ImportCheck>("/contacts/import/check", { method: "POST", body: mappedFile() }));
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Could not check the file");
    } finally {
      setBusy(false);
    }
  }

  async function runImport(): Promise<void> {
    if (!file) return;
    setBusy(true);
    try {
      const res = await apiFetch<ImportResult>("/contacts/import", { method: "POST", body: mappedFile() });
      setResult(res);
      onImported();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  // A row needs a name: a full Name column or a First name column (Last name is joined on).
  const hasName = Object.values(mapping).some((f) => f === "name" || f === "firstName");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-3xl mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold">Import contacts</h3>

        {result ? (
          <div className="space-y-3">
            <p className="text-sm" data-testid="import-result">
              Imported {result.created} {result.created === 1 ? "contact" : "contacts"}, skipped{" "}
              {result.skipped.length}.
            </p>
            <RowNotes title="Skipped" notes={result.skipped} testId="import-skipped" />
            <RowNotes title="Imported with something left out" notes={result.warnings} testId="import-warnings" />
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        ) : check ? (
          <div className="space-y-4">
            <ImportReview check={check} />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCheck(null)}
                disabled={busy}
                className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)]"
              >
                Back
              </button>
              <button
                onClick={runImport}
                disabled={busy || check.toCreate === 0}
                className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-40"
              >
                {busy ? "Importing..." : `Import ${check.toCreate} ${check.toCreate === 1 ? "contact" : "contacts"}`}
              </button>
            </div>
          </div>
        ) : !preview ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--muted-foreground)]">
              Upload a .csv file with a header row (up to 5,000 rows).
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV file"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              className="text-sm"
            />
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[var(--muted-foreground)]">
              {preview.total} {preview.total === 1 ? "row" : "rows"} found. Match each column to a field. Several
              columns can go to Phone or Social links; for any other field the first column is used.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--muted-foreground)] border-b border-[var(--border)]">
                  <th className="py-2 pr-3 font-medium">Column</th>
                  <th className="py-2 pr-3 font-medium">Sample</th>
                  <th className="py-2 font-medium">Field</th>
                </tr>
              </thead>
              <tbody>
                {preview.headers.map((h, i) => (
                  <tr key={`${h}-${i}`} className="border-b border-[var(--border)]">
                    <td className="py-2 pr-3">{h}</td>
                    <td className="py-2 pr-3 text-[var(--muted-foreground)] truncate max-w-[10rem]">
                      {preview.rows[0]?.[i] ?? ""}
                    </td>
                    <td className="py-2">
                      <select
                        aria-label={`Field for ${h}`}
                        value={mapping[h] ?? "skip"}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [h]: e.target.value as ImportField }))
                        }
                        className="px-2 py-1 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                      >
                        {IMPORT_FIELDS.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!hasName && (
              <p className="text-sm text-red-600">Map one column to Name or First name to continue.</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)]"
              >
                Cancel
              </button>
              <button
                onClick={review}
                disabled={busy || !hasName}
                className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-40"
              >
                {busy ? "Checking..." : "Review import"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
