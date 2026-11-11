"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Lock, Palette, Pencil, Plus, Trash2 } from "lucide-react";
import { MAX_PROJECT_STATUSES } from "@atrium/shared";
import { apiFetch } from "@/lib/api";
import { invalidate } from "@/lib/cached";
import { useToast } from "@/components/toast";
import { ColorPatchGrid } from "@/components/color-patch-grid";
import { textColorForBackground } from "@/components/label-badge";
import { PROJECT_STATUSES_PATH, isBuiltInStatus, useProjectStatuses } from "@/lib/project-status";
import type { ProjectStatus } from "@/lib/project-status";

const inputClass =
  "px-2 py-1 border border-[var(--border)] rounded-md bg-[var(--background)] text-xs outline-none focus:ring-1 focus:ring-[var(--primary)]";
const menuItem =
  "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--muted)] disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * Settings → Workspace: the chips on signed projects, for the whole workspace. Click a chip to
 * rename, recolor, move or delete it. Built-in ones can't be deleted, since the app relies on them.
 */
export function ProjectStatusesSection(): React.ReactElement {
  const { success, error: showError } = useToast();
  const statuses: ProjectStatus[] | null = useProjectStatuses();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [coloring, setColoring] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [adding, setAdding] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");
  const [deleting, setDeleting] = useState<ProjectStatus | null>(null);
  const [moveTo, setMoveTo] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const editDone = useRef<boolean>(false);
  const rowRef = useRef<HTMLDivElement>(null);

  // Clicking outside the chips, or Esc, closes an open menu.
  useEffect(() => {
    if (!menuFor) return;
    const close = (): void => {
      setMenuFor(null);
      setColoring(null);
    };
    const onDown = (e: MouseEvent): void => {
      if (!rowRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  const list: ProjectStatus[] = statuses ?? [];

  async function run<T>(action: () => Promise<T>, failure: string): Promise<T | null> {
    setBusy(true);
    try {
      const result: T = await action();
      invalidate(PROJECT_STATUSES_PATH);
      return result;
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : failure);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const patch = (id: string, body: { name?: string; color?: string }): Promise<unknown> =>
    apiFetch(`/project-statuses/${id}`, { method: "PATCH", body: JSON.stringify(body) });

  async function rename(status: ProjectStatus): Promise<void> {
    if (editDone.current) return;
    editDone.current = true;
    const name: string = editName.trim();
    if (!name || name === status.name) {
      setRenamingId(null);
      return;
    }
    if ((await run(() => patch(status.id, { name }), "Failed to rename status")) !== null) {
      success("Status renamed");
    }
    // Close on failure too, so the blur that follows doesn't send the same request again.
    setRenamingId(null);
  }

  async function recolor(status: ProjectStatus, color: string): Promise<void> {
    await run(() => patch(status.id, { color }), "Failed to change the color");
  }

  async function move(index: number, by: -1 | 1): Promise<void> {
    const ids: string[] = list.map((s) => s.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    await run(() => apiFetch("/project-statuses/order", { method: "PUT", body: JSON.stringify({ ids }) }), "Failed to reorder");
  }

  async function remove(): Promise<void> {
    if (!deleting) return;
    const ok = await run(
      () => apiFetch(`/project-statuses/${deleting.id}?moveTo=${encodeURIComponent(moveTo)}`, { method: "DELETE" }),
      "Failed to delete status",
    );
    if (ok !== null) {
      success("Status deleted");
      setDeleting(null);
    }
  }

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const name: string = newName.trim();
    if (!name) return;
    const created = await run(
      () => apiFetch("/project-statuses", { method: "POST", body: JSON.stringify({ name }) }),
      "Failed to add status",
    );
    if (created) {
      setNewName("");
      setAdding(false);
    }
  }

  function chipMenu(status: ProjectStatus, index: number): React.ReactNode {
    const builtIn: boolean = isBuiltInStatus(status.slug);
    const pick = (action: () => void) => () => {
      setMenuFor(null);
      action();
    };
    return (
      <div
        role="menu"
        aria-label={`${status.name} actions`}
        className="absolute left-0 top-full mt-1 w-48 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg z-20 py-1 flex flex-col"
      >
        <button
          role="menuitem"
          autoFocus
          onClick={pick(() => {
            editDone.current = false;
            setEditName(status.name);
            setRenamingId(status.id);
          })}
          className={menuItem}
        >
          <Pencil size={13} /> Rename
        </button>
        <button role="menuitem" onClick={() => setColoring(coloring === status.id ? null : status.id)} className={menuItem}>
          <Palette size={13} /> Change color
        </button>
        {coloring === status.id && (
          <div className="px-2 py-1.5">
            <ColorPatchGrid value={status.color} onChange={(hex) => recolor(status, hex)} />
          </div>
        )}
        <button role="menuitem" disabled={busy || index === 0} onClick={pick(() => move(index, -1))} className={menuItem}>
          <ArrowLeft size={13} /> Move earlier
        </button>
        <button
          role="menuitem"
          disabled={busy || index === list.length - 1}
          onClick={pick(() => move(index, 1))}
          className={menuItem}
        >
          <ArrowRight size={13} /> Move later
        </button>
        {builtIn ? (
          <p className="flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--muted-foreground)]">
            <Lock size={12} /> Built in: can be renamed, not deleted
          </p>
        ) : (
          <button
            role="menuitem"
            onClick={pick(() => {
              setDeleting(status);
              setMoveTo(list.find((s) => s.id !== status.id)?.id ?? "");
            })}
            className={`${menuItem} text-red-600`}
          >
            <Trash2 size={13} /> Delete
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Project statuses</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-0.5 max-w-xl">
          The chips on every signed project in this workspace. Click one to rename, recolor, move or delete it. Built-in
          statuses can be renamed but not deleted.
        </p>
      </div>

      {statuses && (
        <div ref={rowRef} className="flex flex-wrap items-center gap-1.5">
          {list.map((s, i) => (
            <span key={s.id} className="relative">
              {renamingId === s.id ? (
                <input
                  aria-label={`Rename ${s.name}`}
                  value={editName}
                  maxLength={40}
                  autoFocus
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => rename(s)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") rename(s);
                    if (e.key === "Escape") {
                      editDone.current = true;
                      setRenamingId(null);
                    }
                  }}
                  className={`${inputClass} w-32`}
                />
              ) : (
                <button
                  data-testid="project-status-chip"
                  aria-pressed={menuFor === s.id}
                  aria-haspopup="menu"
                  onClick={() => {
                    setColoring(null);
                    setMenuFor(menuFor === s.id ? null : s.id);
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                    menuFor === s.id ? "ring-2 ring-offset-2 ring-offset-[var(--background)] ring-[var(--foreground)]/40" : ""
                  }`}
                  style={{ backgroundColor: s.color, color: textColorForBackground(s.color) }}
                >
                  {s.name}
                </button>
              )}
              {menuFor === s.id && chipMenu(s, i)}
            </span>
          ))}
          {list.length < MAX_PROJECT_STATUSES &&
            (adding ? (
              <form onSubmit={add} className="flex items-center gap-1.5">
                <input
                  aria-label="New status"
                  placeholder="Status name"
                  value={newName}
                  maxLength={40}
                  autoFocus
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setAdding(false);
                      setNewName("");
                    }
                  }}
                  className={`${inputClass} w-32`}
                />
                <button
                  type="submit"
                  disabled={busy || !newName.trim()}
                  className="px-2.5 py-1 bg-[var(--primary)] text-white rounded-md text-xs disabled:opacity-40"
                >
                  Add
                </button>
              </form>
            ) : (
              <button
                onClick={() => {
                  setMenuFor(null);
                  setAdding(true);
                }}
                aria-label="Add a status"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
              >
                <Plus size={14} /> Add status
              </button>
            ))}
        </div>
      )}

      {deleting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && setDeleting(null)}
          onKeyDown={(e) => e.key === "Escape" && setDeleting(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-status-title"
            className="w-full max-w-sm rounded-xl bg-[var(--background)] border border-[var(--border)] shadow-xl p-5 space-y-4"
          >
            <h3 id="delete-status-title" className="text-base font-semibold">
              Delete &ldquo;{deleting.name}&rdquo;?
            </h3>
            <div className="space-y-1.5">
              <label htmlFor="status-move-to" className="text-sm text-[var(--muted-foreground)]">
                Move its projects to
              </label>
              <select
                id="status-move-to"
                value={moveTo}
                autoFocus
                onChange={(e) => setMoveTo(e.target.value)}
                className="w-full px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
              >
                {list
                  .filter((o) => o.id !== deleting.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="px-3 py-1.5 rounded-lg text-sm hover:bg-[var(--muted)]">
                Cancel
              </button>
              <button
                onClick={remove}
                disabled={busy || !moveTo}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm disabled:opacity-40"
              >
                Delete status
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
