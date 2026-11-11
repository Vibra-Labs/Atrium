"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, MoreHorizontal, Pencil, Plus, Trash2, Trophy } from "lucide-react";
import { MAX_PURSUIT_STAGES, PURSUIT_PIPELINE_LABELS, PURSUIT_PIPELINES } from "@atrium/shared";
import { apiFetch } from "@/lib/api";
import { invalidate } from "@/lib/cached";
import { useToast } from "@/components/toast";
import { StageTracker, TrackerDot } from "@/components/stage-tracker";
import type { TrackerStep } from "@/components/stage-tracker";
import { PIPELINE_STAGES_PATH, stagesFor, usePipelineStages } from "@/lib/pursuit";
import type { PipelineStage, PursuitPipeline } from "@/lib/pursuit";

const inputClass =
  "px-2 py-1 border border-[var(--border)] rounded-md bg-[var(--background)] text-xs outline-none focus:ring-1 focus:ring-[var(--primary)]";
const menuItem =
  "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--muted)] disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * Settings → Workspace: the stages of the Bids and Commercial pipelines, shown as a tracker.
 * Like Linear's workflow settings, each stage is edited in place from its ⋯ menu.
 */
export function PipelineStagesSection(): React.ReactElement {
  const { success, error: showError } = useToast();
  const all: PipelineStage[] | null = usePipelineStages();
  const [pipeline, setPipeline] = useState<PursuitPipeline>("commercial");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [adding, setAdding] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");
  const [deleting, setDeleting] = useState<PipelineStage | null>(null);
  const [moveTo, setMoveTo] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  // True once the current edit is committed or cancelled, so the blur that
  // follows Enter/Escape (input unmount) does not save again.
  const editDone = useRef<boolean>(false);

  const stages: PipelineStage[] = stagesFor(all, pipeline === "bid");
  const byId = (id: string): PipelineStage => stages.find((s) => s.id === id)!;

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
      setRenamingId(null);
      return;
    }
    const ok = await run(
      () => apiFetch(`/pursuit-stages/${stage.id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
      "Failed to rename stage",
    );
    if (ok !== null) {
      success("Stage renamed");
      setRenamingId(null);
    } else {
      editDone.current = false;
    }
  }

  async function move(stage: PipelineStage, by: -1 | 1): Promise<void> {
    const ids: string[] = stages.map((s) => s.id);
    const i: number = ids.indexOf(stage.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    await run(
      () => apiFetch("/pursuit-stages/order", { method: "PUT", body: JSON.stringify({ pipeline, ids }) }),
      "Failed to reorder stages",
    );
  }

  async function remove(): Promise<void> {
    if (!deleting) return;
    const ok = await run(
      () => apiFetch(`/pursuit-stages/${deleting.id}?moveTo=${encodeURIComponent(moveTo)}`, { method: "DELETE" }),
      "Failed to delete stage",
    );
    if (ok !== null) {
      success("Stage deleted");
      setDeleting(null);
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
      setAdding(false);
    }
  }

  function labelFor(step: TrackerStep): React.ReactNode {
    if (renamingId !== step.key) return step.label;
    const stage: PipelineStage = byId(step.key);
    return (
      <input
        aria-label={`Rename ${stage.name}`}
        value={editName}
        maxLength={40}
        autoFocus
        onChange={(e) => setEditName(e.target.value)}
        onBlur={() => rename(stage)}
        onKeyDown={(e) => {
          if (e.key === "Enter") rename(stage);
          if (e.key === "Escape") {
            editDone.current = true;
            setRenamingId(null);
          }
        }}
        className={`${inputClass} w-28`}
      />
    );
  }

  function actionsFor(step: TrackerStep): React.ReactNode {
    if (renamingId === step.key) return null;
    const stage: PipelineStage = byId(step.key);
    const i: number = stages.indexOf(stage);
    const open: boolean = menuFor === stage.id;
    const pick = (action: () => void) => () => {
      setMenuFor(null);
      action();
    };
    return (
      <span
        className="relative"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setMenuFor(null);
        }}
      >
        <button
          onClick={() => setMenuFor(open ? null : stage.id)}
          aria-label={`Actions for ${stage.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] focus:opacity-100 ${
            open ? "opacity-100" : "sm:opacity-0 sm:group-hover:opacity-100"
          }`}
        >
          <MoreHorizontal size={14} />
        </button>
        {open && (
          <span
            role="menu"
            className="absolute left-1/2 -translate-x-1/2 top-full mt-1 w-40 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg z-20 overflow-hidden py-1 flex flex-col"
          >
            <button
              role="menuitem"
              onClick={pick(() => {
                editDone.current = false;
                setEditName(stage.name);
                setRenamingId(stage.id);
              })}
              className={menuItem}
            >
              <Pencil size={13} /> Rename
            </button>
            <button role="menuitem" disabled={busy || i === 0} onClick={pick(() => move(stage, -1))} className={menuItem}>
              <ArrowLeft size={13} /> Move earlier
            </button>
            <button
              role="menuitem"
              disabled={busy || i === stages.length - 1}
              onClick={pick(() => move(stage, 1))}
              className={menuItem}
            >
              <ArrowRight size={13} /> Move later
            </button>
            <button
              role="menuitem"
              disabled={stages.length <= 1}
              title={stages.length <= 1 ? "A pipeline needs at least one stage" : undefined}
              onClick={pick(() => {
                setDeleting(stage);
                setMoveTo(stages.find((s) => s.id !== stage.id)?.id ?? "");
              })}
              className={`${menuItem} text-red-600`}
            >
              <Trash2 size={13} /> Delete
            </button>
          </span>
        )}
      </span>
    );
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
              setMenuFor(null);
              setRenamingId(null);
              setAdding(false);
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
          {/* Extra room below so the ⋯ menus, which open under their stage, aren't clipped. */}
          <div className="min-w-0 overflow-x-auto p-1.5 -m-1.5 pb-44 -mb-44">
            <StageTracker
              steps={stages.map((s) => ({ key: s.id, label: s.name }))}
              stepTestId="pipeline-stage-step"
              labelFor={labelFor}
              actionsFor={actionsFor}
              end={
                <span title="Won and Lost always come last">
                  <TrackerDot
                    dot={<Trophy size={13} aria-hidden />}
                    label={<span className="text-[var(--muted-foreground)]">Won</span>}
                    dotClassName="border-dashed border-green-600/60 text-green-600"
                  />
                </span>
              }
            />
          </div>
          {stages.length < MAX_PURSUIT_STAGES &&
            (adding ? (
              <form onSubmit={add} className="flex items-center gap-1.5 self-start">
                <input
                  aria-label="New stage"
                  placeholder="Stage name"
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
                  className={`${inputClass} w-36`}
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
                onClick={() => setAdding(true)}
                aria-label="Add a stage"
                className="self-start inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
              >
                <Plus size={14} /> Add stage
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
            aria-labelledby="delete-stage-title"
            className="w-full max-w-sm rounded-xl bg-[var(--background)] border border-[var(--border)] shadow-xl p-5 space-y-4"
          >
            <h3 id="delete-stage-title" className="text-base font-semibold">
              Delete &ldquo;{deleting.name}&rdquo;?
            </h3>
            <div className="space-y-1.5">
              <label htmlFor="pipeline-stage-move-to" className="text-sm text-[var(--muted-foreground)]">
                Move its contracts to
              </label>
              <select
                id="pipeline-stage-move-to"
                value={moveTo}
                autoFocus
                onChange={(e) => setMoveTo(e.target.value)}
                className="w-full px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
              >
                {stages
                  .filter((o) => o.id !== deleting.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-[var(--muted-foreground)]">Won and lost contracts in this stage move too.</p>
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
                Delete stage
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
