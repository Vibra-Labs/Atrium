"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Plus, Trophy } from "lucide-react";
import { MAX_PURSUIT_STAGES, PURSUIT_PIPELINE_LABELS, PURSUIT_PIPELINES } from "@atrium/shared";
import { apiFetch } from "@/lib/api";
import { invalidate } from "@/lib/cached";
import { useToast } from "@/components/toast";
import { StageTracker, TrackerDot } from "@/components/stage-tracker";
import { PIPELINE_STAGES_PATH, stagesFor, usePipelineStages } from "@/lib/pursuit";
import type { PipelineStage, PursuitPipeline } from "@/lib/pursuit";

const inputClass =
  "px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]";
const btn =
  "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--border)] text-xs hover:bg-[var(--muted)] disabled:opacity-40 disabled:hover:bg-transparent";

/** Settings → Workspace: the stages of the Bids and Commercial pipelines, shown as a tracker. */
export function PipelineStagesSection(): React.ReactElement {
  const { success, error: showError } = useToast();
  const all: PipelineStage[] | null = usePipelineStages();
  const [pipeline, setPipeline] = useState<PursuitPipeline>("commercial");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState<boolean>(false);
  const [editing, setEditing] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>("");
  const [newName, setNewName] = useState<string>("");
  const [removing, setRemoving] = useState<boolean>(false);
  const [moveTo, setMoveTo] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  // True once the current edit is committed or cancelled, so the blur that
  // follows Enter/Escape (input unmount) does not save again.
  const editDone = useRef<boolean>(false);

  const stages: PipelineStage[] = stagesFor(all, pipeline === "bid");
  // The edit bar follows the selected stage; it falls back to the first one.
  const selected: PipelineStage | undefined = adding
    ? undefined
    : (stages.find((s) => s.id === selectedId) ?? stages[0]);
  const index: number = selected ? stages.indexOf(selected) : -1;

  function select(id: string | null): void {
    setSelectedId(id);
    setAdding(false);
    setEditing(false);
    setRemoving(false);
  }

  async function run<T>(action: () => Promise<T>, failure: string): Promise<T | null> {
    setBusy(true);
    try {
      const result: T = await action();
      invalidate(PIPELINE_STAGES_PATH);
      return result;
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : failure);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function rename(stage: PipelineStage): Promise<void> {
    if (editDone.current) return;
    editDone.current = true;
    const name: string = editName.trim();
    if (!name || name === stage.name) {
      setEditing(false);
      return;
    }
    const ok = await run(
      () => apiFetch(`/pursuit-stages/${stage.id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
      "Failed to rename stage",
    );
    if (ok) {
      success("Stage renamed");
      setEditing(false);
    } else {
      editDone.current = false;
    }
  }

  async function move(by: -1 | 1): Promise<void> {
    const ids: string[] = stages.map((s) => s.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    await run(
      () => apiFetch("/pursuit-stages/order", { method: "PUT", body: JSON.stringify({ pipeline, ids }) }),
      "Failed to reorder stages",
    );
  }

  async function remove(stage: PipelineStage): Promise<void> {
    const ok = await run(
      () => apiFetch(`/pursuit-stages/${stage.id}?moveTo=${encodeURIComponent(moveTo)}`, { method: "DELETE" }),
      "Failed to remove stage",
    );
    if (ok !== null) {
      success("Stage removed");
      select(null);
    }
  }

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const name: string = newName.trim();
    if (!name) return;
    const created = await run(
      () => apiFetch<PipelineStage>("/pursuit-stages", { method: "POST", body: JSON.stringify({ pipeline, name }) }),
      "Failed to add stage",
    );
    if (created) {
      setNewName("");
      select(created.id);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Pipeline stages</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-0.5 max-w-xl">
          The steps a potential contract moves through before it&apos;s won or lost. Bids are contracts marked as a
          bid (RFP/RFQ); everything else is Commercial. Click a stage to change it.
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
              select(null);
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
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
          <div className="min-w-0 overflow-x-auto p-1.5 -m-1.5">
            <StageTracker
              steps={stages.map((s) => ({ key: s.id, label: s.name }))}
              selectedKey={selected?.id ?? null}
              onSelect={select}
              stepTestId="pipeline-stage-step"
              end={
                <span title="Won and Lost are always the last step">
                  <TrackerDot
                    dot={<Trophy size={13} aria-hidden />}
                    label={<span className="text-[var(--muted-foreground)]">Won</span>}
                    dotClassName="border-dashed border-green-600/60 text-green-600"
                  />
                </span>
              }
            />
          </div>
          {stages.length < MAX_PURSUIT_STAGES && (
            <button
              onClick={() => {
                select(null);
                setAdding(true);
              }}
              aria-label="Add a stage"
              aria-pressed={adding}
              className="self-start inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/40"
            >
              <Plus size={14} /> Add stage
            </button>
          )}
        </div>
      )}

      {adding && (
        <form onSubmit={add} className="flex gap-2 max-w-md rounded-xl border border-[var(--border)] p-3">
          <input
            aria-label="New stage"
            placeholder={`New ${PURSUIT_PIPELINE_LABELS[pipeline].toLowerCase()} stage`}
            value={newName}
            maxLength={40}
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            className={`${inputClass} flex-1 min-w-0`}
          />
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm disabled:opacity-40"
          >
            Add
          </button>
          <button type="button" onClick={() => setAdding(false)} className="px-2 text-sm hover:underline">
            Cancel
          </button>
        </form>
      )}

      {selected && (
        <div data-testid="pipeline-stage-editor" className="max-w-md rounded-xl border border-[var(--border)] p-3 space-y-3">
          {editing ? (
            <input
              aria-label={`Rename ${selected.name}`}
              value={editName}
              maxLength={40}
              autoFocus
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => rename(selected)}
              onKeyDown={(e) => {
                if (e.key === "Enter") rename(selected);
                if (e.key === "Escape") {
                  editDone.current = true;
                  setEditing(false);
                }
              }}
              className={`${inputClass} w-full`}
            />
          ) : (
            <p className="text-sm font-medium">
              <span className="text-[var(--muted-foreground)] font-normal">Step {index + 1} · </span>
              {selected.name}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                editDone.current = false;
                setEditing(true);
                setEditName(selected.name);
              }}
              aria-label={`Rename ${selected.name}`}
              className={btn}
            >
              Rename
            </button>
            <button
              onClick={() => move(-1)}
              disabled={busy || index === 0}
              aria-label={`Move ${selected.name} earlier`}
              className={btn}
            >
              <ArrowLeft size={13} /> Earlier
            </button>
            <button
              onClick={() => move(1)}
              disabled={busy || index === stages.length - 1}
              aria-label={`Move ${selected.name} later`}
              className={btn}
            >
              Later <ArrowRight size={13} />
            </button>
            <button
              onClick={() => {
                setRemoving(true);
                setMoveTo(stages.find((s) => s.id !== selected.id)?.id ?? "");
              }}
              disabled={stages.length <= 1}
              title={stages.length <= 1 ? "A pipeline needs at least one stage" : undefined}
              aria-label={`Remove ${selected.name}`}
              className={`${btn} hover:text-red-600`}
            >
              Remove
            </button>
          </div>
          {removing && (
            <div className="flex flex-wrap items-center gap-2 text-xs border-t border-[var(--border)] pt-3">
              <label htmlFor="pipeline-stage-move-to" className="text-[var(--muted-foreground)]">
                Move its contracts to
              </label>
              <select
                id="pipeline-stage-move-to"
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value)}
                className={`${inputClass} py-1 text-xs`}
              >
                {stages
                  .filter((o) => o.id !== selected.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
              <button
                onClick={() => remove(selected)}
                disabled={busy || !moveTo}
                className="px-2.5 py-1 rounded-lg bg-red-600 text-white disabled:opacity-40"
              >
                Remove stage
              </button>
              <button onClick={() => setRemoving(false)} className="px-2 py-1 hover:underline">
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
