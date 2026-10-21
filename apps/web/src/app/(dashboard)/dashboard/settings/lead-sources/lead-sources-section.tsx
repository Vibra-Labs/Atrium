"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import { invalidate } from "@/lib/cached";

interface LeadSource {
  id: string;
  name: string;
}

const inputClass =
  "px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]";

export function LeadSourcesSection(): React.ReactElement {
  const { success, error: showError } = useToast();
  const confirm = useConfirm();
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [newName, setNewName] = useState<string>("");
  // True once the current edit is committed or cancelled, so the blur that
  // follows Enter/Escape (input unmount) does not save again.
  const editDone = useRef<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setSources(await apiFetch<LeadSource[]>("/lead-sources"));
    } catch (err) {
      console.error(err);
      showError("Failed to load lead sources");
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<unknown>, failure: string): Promise<boolean> {
    try {
      await action();
      invalidate("/lead-sources");
      await load();
      return true;
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : failure);
      return false;
    }
  }

  async function rename(source: LeadSource): Promise<void> {
    if (editDone.current) return;
    editDone.current = true;
    const name = editName.trim();
    if (!name || name === source.name) {
      setEditingId(null);
      return;
    }
    const ok = await run(
      () => apiFetch(`/lead-sources/${source.id}`, { method: "PUT", body: JSON.stringify({ name }) }),
      "Failed to rename lead source",
    );
    if (ok) {
      success("Lead source renamed");
      setEditingId(null);
    } else {
      editDone.current = false;
    }
  }

  async function remove(source: LeadSource): Promise<void> {
    const ok = await confirm({
      title: "Delete lead source",
      message: `Delete "${source.name}"? Contacts using it keep no source.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    const deleted = await run(
      () => apiFetch(`/lead-sources/${source.id}`, { method: "DELETE" }),
      "Failed to delete lead source",
    );
    if (deleted) success("Lead source deleted");
  }

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const added = await run(
      () => apiFetch("/lead-sources", { method: "POST", body: JSON.stringify({ name }) }),
      "Failed to add lead source",
    );
    if (added) setNewName("");
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Lead sources</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
          Where your contacts come from. Pick one on each contact to see what brings in business.
        </p>
      </div>
      {!loading && (
        <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl max-w-md">
          {sources.map((s) => (
            <li
              key={s.id}
              data-testid="lead-source-row"
              className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
            >
              {editingId === s.id ? (
                <input
                  aria-label={`Rename ${s.name}`}
                  value={editName}
                  autoFocus
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => rename(s)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") rename(s);
                    if (e.key === "Escape") {
                      editDone.current = true;
                      setEditingId(null);
                    }
                  }}
                  className={`${inputClass} flex-1`}
                />
              ) : (
                <span>{s.name}</span>
              )}
              <span className="flex gap-3 text-[var(--muted-foreground)]">
                <button
                  onClick={() => {
                    editDone.current = false;
                    setEditingId(s.id);
                    setEditName(s.name);
                  }}
                  aria-label={`Edit ${s.name}`}
                  className="hover:text-[var(--foreground)]"
                >
                  Rename
                </button>
                <button
                  onClick={() => remove(s)}
                  aria-label={`Delete ${s.name}`}
                  className="hover:text-red-600"
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex gap-2 max-w-md">
        <input
          aria-label="New lead source"
          placeholder="New lead source"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className={`${inputClass} flex-1`}
        />
        <button
          type="submit"
          disabled={!newName.trim()}
          className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm disabled:opacity-40"
        >
          Add
        </button>
      </form>
    </div>
  );
}
