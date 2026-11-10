"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { MAX_PURSUIT_STAGES, PURSUIT_PIPELINE_LABELS, PURSUIT_PIPELINES } from "@atrium/shared";
import { apiFetch } from "@/lib/api";
import { invalidate } from "@/lib/cached";
import { useToast } from "@/components/toast";
import { PIPELINE_STAGES_PATH, stagesFor, usePipelineStages } from "@/lib/pursuit";
import type { PipelineStage, PursuitPipeline } from "@/lib/pursuit";

const inputClass =
  "px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]";
const iconBtn = "p-1 rounded hover:text-[var(--foreground)] disabled:opacity-30 disabled:hover:text-inherit";

/** Settings → Workspace: the stages of the Bids and Commercial pipelines. */
export function PipelineStagesSection(): React.ReactElement {
  const { success, error: showError } = useToast();
  const all: PipelineStage[] | null = usePipelineStages();
  const [pipeline, setPipeline] = useState<PursuitPipeline>("commercial");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [newName, setNewName] = useState<string>("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  // True once the current edit is committed or cancelled, so the blur that
  // follows Enter/Escape (input unmount) does not save again.
  const editDone = useRef<boolean>(false);

  const stages: PipelineStage[] = stagesFor(all, pipeline === "bid");

  async function run(action: () => Promise<unknown>, failure: string): Promise<boolean> {
    setBusy(true);
    try {
      await action();
      invalidate(PIPELINE_STAGES_PATH);
      return true;
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function rename(stage: PipelineStage): Promise<void> {
    if (editDone.current) return;
    editDone.current = true;
    const name: string = editName.trim();
    if (!name || name === stage.name) {
      setEditingId(null);
      return;
    }
    const ok: boolean = await run(
      () => apiFetch(`/pursuit-stages/${stage.id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
      "Failed to rename stage",
    );
    if (ok) {
      success("Stage renamed");
      setEditingId(null);
    } else {
      editDone.current = false;
    }
  }

  async function move(index: number, by: -1 | 1): Promise<void> {
    const ids: string[] = stages.map((s) => s.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    await run(
      () => apiFetch("/pursuit-stages/order", { method: "PUT", body: JSON.stringify({ pipeline, ids }) }),
      "Failed to reorder stages",
    );
  }

  function startRemove(stage: PipelineStage): void {
    setRemovingId(stage.id);
    setMoveTo(stages.find((s) => s.id !== stage.id)?.id ?? "");
  }

  async function remove(stage: PipelineStage): Promise<void> {
    const ok: boolean = await run(
      () =>
        apiFetch(`/pursuit-stages/${stage.id}?moveTo=${encodeURIComponent(moveTo)}`, { method: "DELETE" }),
      "Failed to remove stage",
    );
    if (ok) {
      success("Stage removed");
      setRemovingId(null);
    }
  }

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const name: string = newName.trim();
    if (!name) return;
    const added: boolean = await run(
      () => apiFetch("/pursuit-stages", { method: "POST", body: JSON.stringify({ pipeline, name }) }),
      "Failed to add stage",
    );
    if (added) setNewName("");
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Pipeline stages</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-0.5 max-w-xl">
          The steps a potential contract moves through before it&apos;s won or lost. Bids are contracts marked as a
          bid (RFP/RFQ); everything else is Commercial.
        </p>
      </div>

      <div role="tablist" aria-label="Pipeline" className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
        {PURSUIT_PIPELINES.map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={pipeline === p}
            onClick={() => {
              setPipeline(p);
              setEditingId(null);
              setRemovingId(null);
            }}
            className={`px-3 py-1 rounded-md text-sm ${
              pipeline === p ? "bg-[var(--muted)] font-medium" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            {PURSUIT_PIPELINE_LABELS[p]}
          </button>
        ))}
      </div>

      {all && (
        <ol className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl max-w-md">
          {stages.map((s, i) => (
            <li key={s.id} data-testid="pipeline-stage-row" className="px-4 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                {editingId === s.id ? (
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
                        setEditingId(null);
                      }
                    }}
                    className={`${inputClass} flex-1 min-w-0`}
                  />
                ) : (
                  <span className="min-w-0 truncate">{s.name}</span>
                )}
                <span className="flex items-center gap-2 shrink-0 text-[var(--muted-foreground)]">
                  <button
                    onClick={() => move(i, -1)}
                    disabled={busy || i === 0}
                    aria-label={`Move ${s.name} up`}
                    className={iconBtn}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={busy || i === stages.length - 1}
                    aria-label={`Move ${s.name} down`}
                    className={iconBtn}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    onClick={() => {
                      editDone.current = false;
                      setEditingId(s.id);
                      setEditName(s.name);
                    }}
                    aria-label={`Rename ${s.name}`}
                    className="hover:text-[var(--foreground)]"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => startRemove(s)}
                    disabled={stages.length <= 1}
                    title={stages.length <= 1 ? "A pipeline needs at least one stage" : undefined}
                    aria-label={`Remove ${s.name}`}
                    className="hover:text-red-600 disabled:opacity-30 disabled:hover:text-inherit"
                  >
                    Remove
                  </button>
                </span>
              </div>
              {removingId === s.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <label htmlFor={`move-${s.id}`} className="text-[var(--muted-foreground)]">
                    Move its contracts to
                  </label>
                  <select
                    id={`move-${s.id}`}
                    value={moveTo}
                    onChange={(e) => setMoveTo(e.target.value)}
                    className={`${inputClass} py-1 text-xs`}
                  >
                    {stages
                      .filter((o) => o.id !== s.id)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => remove(s)}
                    disabled={busy || !moveTo}
                    className="px-2.5 py-1 rounded-lg bg-red-600 text-white disabled:opacity-40"
                  >
                    Remove stage
                  </button>
                  <button onClick={() => setRemovingId(null)} className="px-2 py-1 hover:underline">
                    Cancel
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {all && stages.length < MAX_PURSUIT_STAGES && (
        <form onSubmit={add} className="flex gap-2 max-w-md">
          <input
            aria-label="New stage"
            placeholder={`New ${PURSUIT_PIPELINE_LABELS[pipeline].toLowerCase()} stage`}
            value={newName}
            maxLength={40}
            onChange={(e) => setNewName(e.target.value)}
            className={`${inputClass} flex-1 min-w-0`}
          />
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm disabled:opacity-40"
          >
            Add
          </button>
        </form>
      )}
    </div>
  );
}
