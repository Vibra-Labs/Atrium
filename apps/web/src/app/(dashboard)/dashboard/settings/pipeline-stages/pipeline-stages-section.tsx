"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, Pencil, Plus, Trash2, Trophy } from "lucide-react";
import { MAX_PURSUIT_PIPELINES, MAX_PURSUIT_STAGES } from "@atrium/shared";
import { apiFetch } from "@/lib/api";
import { invalidate } from "@/lib/cached";
import { useToast } from "@/components/toast";
import { StageTracker, TrackerDot } from "@/components/stage-tracker";
import type { TrackerStep } from "@/components/stage-tracker";
import { PIPELINES_PATH, pipelineFor, stagesFor, usePipelines } from "@/lib/pursuit";
import type { Pipeline, PipelineStage } from "@/lib/pursuit";

const inputClass =
  "px-2 py-1 border border-[var(--border)] rounded-md bg-[var(--background)] text-xs outline-none focus:ring-1 focus:ring-[var(--primary)]";
const menuClass =
  "absolute top-full mt-1 w-40 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg z-20 overflow-hidden py-1 flex flex-col";
const menuItem =
  "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--muted)] disabled:opacity-40 disabled:hover:bg-transparent";

/** What the open menu, rename box or delete dialog is for. */
type Target = { kind: "pipeline" | "stage"; id: string };
type Deleting = Target & { name: string; options: { id: string; name: string }[] };

/**
 * Settings → Workspace: the workspace's pipelines, each shown as a tracker of its stages.
 * Like Linear's workflow settings, everything is edited in place: click a pipeline or a stage for its menu.
 */
export function PipelineStagesSection(): React.ReactElement {
  const { success, error: showError } = useToast();
  const pipelines: Pipeline[] | null = usePipelines();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<Target | null>(null);
  const [renaming, setRenaming] = useState<Target | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [adding, setAdding] = useState<"pipeline" | "stage" | null>(null);
  const [newName, setNewName] = useState<string>("");
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const [moveTo, setMoveTo] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  // True once the current edit is committed or cancelled, so the blur that
  // follows Enter/Escape (input unmount) does not save again.
  const editDone = useRef<boolean>(false);
  const editorRef = useRef<HTMLDivElement>(null);

  // Clicking outside the editor, or Esc, closes an open menu.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent): void => {
      if (!editorRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const list: Pipeline[] = pipelines ?? [];
  const pipeline: Pipeline | null = pipelineFor(pipelines, selectedId);
  const stages: PipelineStage[] = stagesFor(pipelines, pipeline?.id ?? null);
  const isOpen = (kind: Target["kind"], id: string): boolean => menu?.kind === kind && menu.id === id;
  const isRenaming = (kind: Target["kind"], id: string): boolean => renaming?.kind === kind && renaming.id === id;

  function reset(): void {
    setMenu(null);
    setRenaming(null);
    setAdding(null);
    setNewName("");
  }

  async function run<T>(action: () => Promise<T>, failure: string): Promise<T | null> {
    setBusy(true);
    try {
      const result: T = await action();
      invalidate(PIPELINES_PATH);
      return result;
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : failure);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const path = (kind: Target["kind"]): string => (kind === "pipeline" ? "/pursuit-pipelines" : "/pursuit-stages");

  function startRename(target: Target, name: string): void {
    editDone.current = false;
    setEditName(name);
    setRenaming(target);
  }

  async function rename(target: Target, current: string): Promise<void> {
    if (editDone.current) return;
    editDone.current = true;
    const name: string = editName.trim();
    if (!name || name === current) {
      setRenaming(null);
      return;
    }
    const ok = await run(
      () => apiFetch(`${path(target.kind)}/${target.id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
      "Failed to rename",
    );
    if (ok !== null) success(target.kind === "pipeline" ? "Pipeline renamed" : "Stage renamed");
    // Close on failure too, so the blur that follows doesn't send the same request again.
    setRenaming(null);
  }

  async function move(kind: Target["kind"], id: string, by: -1 | 1): Promise<void> {
    const ids: string[] = (kind === "pipeline" ? list : stages).map((x) => x.id);
    const i: number = ids.indexOf(id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    const body = kind === "pipeline" ? { ids } : { pipelineId: pipeline?.id, ids };
    await run(() => apiFetch(`${path(kind)}/order`, { method: "PUT", body: JSON.stringify(body) }), "Failed to reorder");
  }

  function startDelete(target: Target, name: string): void {
    const options = (target.kind === "pipeline" ? list : stages)
      .filter((x) => x.id !== target.id)
      .map((x) => ({ id: x.id, name: x.name }));
    setDeleting({ ...target, name, options });
    setMoveTo(options[0]?.id ?? "");
  }

  async function remove(): Promise<void> {
    if (!deleting) return;
    const ok = await run(
      () => apiFetch(`${path(deleting.kind)}/${deleting.id}?moveTo=${encodeURIComponent(moveTo)}`, { method: "DELETE" }),
      "Failed to delete",
    );
    if (ok !== null) {
      success(deleting.kind === "pipeline" ? "Pipeline deleted" : "Stage deleted");
      if (deleting.kind === "pipeline") setSelectedId(moveTo);
      setDeleting(null);
    }
  }

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const name: string = newName.trim();
    if (!name || !adding) return;
    const body = adding === "pipeline" ? { name } : { pipelineId: pipeline?.id, name };
    const created = await run(
      () => apiFetch<{ id: string }>(path(adding), { method: "POST", body: JSON.stringify(body) }),
      "Failed to add",
    );
    if (created) {
      if (adding === "pipeline") setSelectedId(created.id);
      setNewName("");
      setAdding(null);
    }
  }

  /** Rename / Move earlier / Move later / Delete, under whatever was clicked. */
  function actionMenu(target: Target, name: string, index: number, count: number, align: string): React.ReactNode {
    const pick = (action: () => void) => () => {
      setMenu(null);
      action();
    };
    const noun: string = target.kind === "pipeline" ? "pipeline" : "stage";
    return (
      <div role="menu" aria-label={`${name} actions`} className={`${menuClass} ${align}`}>
        <button role="menuitem" autoFocus onClick={pick(() => startRename(target, name))} className={menuItem}>
          <Pencil size={13} /> Rename
        </button>
        <button
          role="menuitem"
          disabled={busy || index === 0}
          onClick={pick(() => move(target.kind, target.id, -1))}
          className={menuItem}
        >
          <ArrowLeft size={13} /> Move earlier
        </button>
        <button
          role="menuitem"
          disabled={busy || index === count - 1}
          onClick={pick(() => move(target.kind, target.id, 1))}
          className={menuItem}
        >
          <ArrowRight size={13} /> Move later
        </button>
        <button
          role="menuitem"
          disabled={count <= 1}
          title={count <= 1 ? `You need at least one ${noun}` : undefined}
          onClick={pick(() => startDelete(target, name))}
          className={`${menuItem} text-red-600`}
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>
    );
  }

  function renameBox(target: Target, current: string, width: string): React.ReactNode {
    return (
      <input
        aria-label={`Rename ${current}`}
        value={editName}
        maxLength={40}
        autoFocus
        onChange={(e) => setEditName(e.target.value)}
        onBlur={() => rename(target, current)}
        onKeyDown={(e) => {
          if (e.key === "Enter") rename(target, current);
          if (e.key === "Escape") {
            editDone.current = true;
            setRenaming(null);
          }
        }}
        className={`${inputClass} ${width}`}
      />
    );
  }

  function addForm(kind: "pipeline" | "stage"): React.ReactNode {
    return (
      <form onSubmit={add} className="flex items-center gap-1.5">
        <input
          aria-label={kind === "pipeline" ? "New pipeline" : "New stage"}
          placeholder={kind === "pipeline" ? "Pipeline name" : "Stage name"}
          value={newName}
          maxLength={40}
          autoFocus
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && reset()}
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
    );
  }

  const ghostBtn =
    "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Pipelines</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-0.5 max-w-xl">
          The steps a potential contract moves through before it&apos;s won or lost. Set up a pipeline for each kind of
          work; new contracts start in the first one. Click a pipeline or a stage to rename, move or delete it.
        </p>
      </div>

      {pipelines && pipeline && (
        <div ref={editorRef} className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Pipelines" className="inline-flex flex-wrap rounded-lg border border-[var(--border)] p-0.5">
              {list.map((pl, i) => {
                const selected: boolean = pl.id === pipeline.id;
                if (isRenaming("pipeline", pl.id)) {
                  return (
                    <span key={pl.id} className="px-1 py-0.5">
                      {renameBox({ kind: "pipeline", id: pl.id }, pl.name, "w-32")}
                    </span>
                  );
                }
                return (
                  <span key={pl.id} className="relative">
                    <button
                      role="tab"
                      aria-selected={selected}
                      aria-haspopup={selected ? "menu" : undefined}
                      aria-expanded={selected ? isOpen("pipeline", pl.id) : undefined}
                      onClick={() => {
                        if (selected) {
                          setMenu(isOpen("pipeline", pl.id) ? null : { kind: "pipeline", id: pl.id });
                        } else {
                          reset();
                          setSelectedId(pl.id);
                        }
                      }}
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-md text-sm ${
                        selected
                          ? "bg-[var(--muted)] font-medium"
                          : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {pl.name}
                      {selected && <ChevronDown size={13} className="text-[var(--muted-foreground)]" aria-hidden />}
                    </button>
                    {isOpen("pipeline", pl.id) &&
                      actionMenu({ kind: "pipeline", id: pl.id }, pl.name, i, list.length, "left-0")}
                  </span>
                );
              })}
            </div>
            {list.length < MAX_PURSUIT_PIPELINES &&
              (adding === "pipeline" ? (
                addForm("pipeline")
              ) : (
                <button
                  onClick={() => {
                    reset();
                    setAdding("pipeline");
                  }}
                  aria-label="New pipeline"
                  className={ghostBtn}
                >
                  <Plus size={14} /> New pipeline
                </button>
              ))}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
            {/* Extra room below so the menus, which open under their stage, aren't clipped. */}
            <div className="min-w-0 overflow-x-auto p-1.5 -m-1.5 pb-44 -mb-44">
              <StageTracker
                steps={stages.map((s) => ({ key: s.id, label: s.name }))}
                selectedKey={menu?.kind === "stage" ? menu.id : null}
                editingKey={renaming?.kind === "stage" ? renaming.id : null}
                onSelect={(id) => setMenu(isOpen("stage", id) ? null : { kind: "stage", id })}
                stepTestId="pipeline-stage-step"
                labelFor={(step: TrackerStep) =>
                  isRenaming("stage", step.key) ? renameBox({ kind: "stage", id: step.key }, step.label, "w-28") : step.label
                }
                actionsFor={(step: TrackerStep) => {
                  if (!isOpen("stage", step.key)) return null;
                  const i: number = stages.findIndex((s) => s.id === step.key);
                  return actionMenu(
                    { kind: "stage", id: step.key },
                    step.label,
                    i,
                    stages.length,
                    "left-0 sm:left-1/2 sm:-translate-x-1/2",
                  );
                }}
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
            {stages.length < MAX_PURSUIT_STAGES && (
              <div className="self-start">
                {adding === "stage" ? (
                  addForm("stage")
                ) : (
                  <button
                    onClick={() => {
                      reset();
                      setAdding("stage");
                    }}
                    aria-label="Add a stage"
                    className={ghostBtn}
                  >
                    <Plus size={14} /> Add stage
                  </button>
                )}
              </div>
            )}
          </div>
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
            aria-labelledby="delete-pipeline-item-title"
            className="w-full max-w-sm rounded-xl bg-[var(--background)] border border-[var(--border)] shadow-xl p-5 space-y-4"
          >
            <h3 id="delete-pipeline-item-title" className="text-base font-semibold">
              Delete &ldquo;{deleting.name}&rdquo;?
            </h3>
            <div className="space-y-1.5">
              <label htmlFor="pipeline-move-to" className="text-sm text-[var(--muted-foreground)]">
                Move its contracts to
              </label>
              <select
                id="pipeline-move-to"
                value={moveTo}
                autoFocus
                onChange={(e) => setMoveTo(e.target.value)}
                className="w-full px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
              >
                {deleting.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--muted-foreground)]">
                {deleting.kind === "pipeline"
                  ? "Won and lost contracts move too. Each keeps its stage if that pipeline has it, otherwise it starts at the first stage."
                  : "Won and lost contracts in this stage move too."}
              </p>
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
                Delete {deleting.kind}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
