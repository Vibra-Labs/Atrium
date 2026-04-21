"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Link2, Trash2, Check, Plus } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import { CommentsSection } from "@/components/comments-section";
import { LabelBadge } from "@/components/label-badge";
import { Avatar } from "@/components/avatar";
import { ColorPatchGrid, PRESET_COLORS } from "@/components/color-patch-grid";

export interface TaskDetailRecord {
  id: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  status: string;
  type: string;
  requestedById?: string | null;
  assigneeId?: string | null;
  requester?: { id: string; name: string; image?: string | null } | null;
  assignee?: { id: string; name: string; image?: string | null } | null;
  isClientRequest?: boolean;
  labels?: { label: { id: string; name: string; color: string } }[];
  createdAt?: string;
  _count?: { comments: number };
}

export interface TaskDetailMember {
  userId: string;
  user: { id: string; name: string; image?: string | null };
}

export interface TaskDetailLabel {
  id: string;
  name: string;
  color: string;
}

export type TaskDetailViewer = "agency" | "client";

const STATUS_OPTIONS = [
  { value: "open", label: "Open", color: "bg-gray-100 text-gray-700" },
  { value: "in_progress", label: "In Progress", color: "bg-blue-100 text-blue-700" },
  { value: "done", label: "Done", color: "bg-green-100 text-green-700" },
  { value: "cancelled", label: "Cancelled", color: "bg-red-50 text-red-600" },
];

export function TaskDetailModal({
  task,
  viewer,
  currentUserId,
  members,
  labels,
  onLabelsChange,
  onClose,
  onChange,
  onDelete,
}: {
  task: TaskDetailRecord;
  viewer: TaskDetailViewer;
  currentUserId?: string | null;
  members?: TaskDetailMember[];
  labels?: TaskDetailLabel[];
  onLabelsChange?: (labels: TaskDetailLabel[]) => void;
  onClose: () => void;
  /** Called after a successful mutation so the caller can refresh its list. */
  onChange: () => void;
  /** Called after a successful delete. Caller should close + refresh. */
  onDelete?: () => void;
}) {
  const { success, error: showError } = useToast();
  const confirm = useConfirm();
  const isAgency = viewer === "agency";
  const isOwnRequest =
    !!currentUserId && task.requestedById === currentUserId;
  const canCancel = !isAgency && isOwnRequest && task.status === "open";

  const [title, setTitle] = useState(task.title);
  const [titleEditing, setTitleEditing] = useState(false);
  const [description, setDescription] = useState(task.description ?? "");
  const [descEditing, setDescEditing] = useState(false);
  const [dueDate, setDueDate] = useState(task.dueDate ? task.dueDate.split("T")[0] : "");
  const [dueEditing, setDueEditing] = useState(false);
  const [status, setStatus] = useState(task.status);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [assignedLabels, setAssignedLabels] = useState<string[]>(
    task.labels?.map((l) => l.label.id) ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [labelMenuOpen, setLabelMenuOpen] = useState(false);
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState<string>(PRESET_COLORS[0].hex);
  const [savingLabel, setSavingLabel] = useState(false);
  const [labelError, setLabelError] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setSaving(true);
      try {
        await apiFetch(`/tasks/${task.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        onChange();
      } catch (err) {
        showError(err instanceof Error ? err.message : "Update failed");
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [task.id, onChange, showError],
  );

  const handleSaveTitle = async () => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === task.title) {
      setTitle(task.title);
      setTitleEditing(false);
      return;
    }
    try {
      await patch({ title: trimmed });
      setTitleEditing(false);
    } catch {
      setTitle(task.title);
    }
  };

  const handleSaveDescription = async () => {
    if (description === (task.description ?? "")) {
      setDescEditing(false);
      return;
    }
    try {
      await patch({ description: description || null });
      setDescEditing(false);
    } catch {
      setDescription(task.description ?? "");
    }
  };

  const handleSaveDueDate = async () => {
    const normalized = task.dueDate ? task.dueDate.split("T")[0] : "";
    if (dueDate === normalized) {
      setDueEditing(false);
      return;
    }
    try {
      await patch({ dueDate: dueDate || null });
      setDueEditing(false);
    } catch {
      setDueDate(normalized);
    }
  };

  const handleStatusChange = async (next: string) => {
    if (next === status) return;
    const prev = status;
    setStatus(next);
    try {
      await patch({ status: next });
    } catch {
      setStatus(prev);
    }
  };

  const handleAssigneeChange = async (next: string) => {
    if (next === assigneeId) return;
    const prev = assigneeId;
    setAssigneeId(next);
    try {
      await patch({ assigneeId: next || null });
    } catch {
      setAssigneeId(prev);
    }
  };

  const handleToggleLabel = async (labelId: string) => {
    const isAssigned = assignedLabels.includes(labelId);
    const nextIds = isAssigned
      ? assignedLabels.filter((id) => id !== labelId)
      : [...assignedLabels, labelId];
    const previous = assignedLabels;
    setAssignedLabels(nextIds);
    try {
      await apiFetch(`/labels/${labelId}/assign`, {
        method: isAssigned ? "DELETE" : "POST",
        body: JSON.stringify({ entityType: "task", entityId: task.id }),
      });
      onChange();
    } catch (err) {
      setAssignedLabels(previous);
      showError(err instanceof Error ? err.message : "Failed to update labels");
    }
  };

  const handleCreateLabel = async () => {
    if (!newLabelName.trim() || savingLabel) return;
    setSavingLabel(true);
    setLabelError("");
    try {
      const created = await apiFetch<TaskDetailLabel>("/labels", {
        method: "POST",
        body: JSON.stringify({ name: newLabelName.trim(), color: newLabelColor }),
      });
      if (onLabelsChange) {
        const updated = await apiFetch<TaskDetailLabel[]>("/labels");
        onLabelsChange(updated);
      }
      await handleToggleLabel(created.id);
      setNewLabelName("");
      setNewLabelColor(PRESET_COLORS[0].hex);
      setCreatingLabel(false);
    } catch (err) {
      setLabelError(err instanceof Error ? err.message : "Failed to create label");
    } finally {
      setSavingLabel(false);
    }
  };

  const handleCopyLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("task", task.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      success("Link copied");
    } catch {
      showError("Could not copy link");
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete Task",
      message: "Delete this task? This cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/tasks/${task.id}`, { method: "DELETE" });
      success("Task deleted");
      onDelete?.();
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete task");
    }
  };

  const handleCancelClient = async () => {
    const ok = await confirm({
      title: "Cancel Request",
      message: "Cancel this request? You won't be able to undo this.",
      confirmLabel: "Cancel Request",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/tasks/${task.id}/cancel`, { method: "PATCH" });
      success("Request cancelled");
      onChange();
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to cancel");
    }
  };

  const statusOption = STATUS_OPTIONS.find((s) => s.value === status) ?? STATUS_OPTIONS[0];
  const assignedLabelObjects = labels?.filter((l) => assignedLabels.includes(l.id)) ?? [];
  const readOnlyLabels = !isAgency;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="task-detail-modal"
    >
      <div className="bg-[var(--background)] rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusOption.color}`}
          >
            {statusOption.label}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopyLink}
              className="p-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded transition-colors"
              title="Copy link"
              aria-label="Copy link"
            >
              <Link2 size={16} />
            </button>
            {isAgency && (
              <button
                onClick={handleDelete}
                className="p-1.5 text-[var(--muted-foreground)] hover:text-red-500 rounded transition-colors"
                title="Delete"
                aria-label="Delete task"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded transition-colors"
              title="Close"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-0 md:gap-0">
            {/* Main column */}
            <div className="p-5 space-y-4 min-w-0">
              {/* Title */}
              {isAgency && titleEditing ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveTitle();
                      if (e.key === "Escape") {
                        setTitle(task.title);
                        setTitleEditing(false);
                      }
                    }}
                    autoFocus
                    maxLength={255}
                    className="flex-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-lg font-semibold outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  />
                  <button
                    onClick={handleSaveTitle}
                    disabled={saving}
                    className="px-3 py-2 text-sm text-[var(--primary)] hover:underline"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <h2
                  onClick={() => isAgency && setTitleEditing(true)}
                  className={`text-lg font-semibold break-words ${
                    isAgency
                      ? "cursor-text hover:bg-[var(--muted)]/50 rounded px-1 -mx-1"
                      : ""
                  }`}
                  data-testid="task-title"
                >
                  {task.title}
                </h2>
              )}

              {/* Description */}
              {isAgency && descEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setDescription(task.description ?? "");
                        setDescEditing(false);
                      }
                    }}
                    autoFocus
                    rows={4}
                    maxLength={5000}
                    placeholder="Add a description..."
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm resize-y outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveDescription}
                      disabled={saving}
                      className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setDescription(task.description ?? "");
                        setDescEditing(false);
                      }}
                      className="px-3 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : description ? (
                <p
                  onClick={() => isAgency && setDescEditing(true)}
                  className={`text-sm whitespace-pre-wrap break-words text-[var(--foreground)] ${
                    isAgency
                      ? "cursor-text hover:bg-[var(--muted)]/50 rounded px-1 -mx-1"
                      : ""
                  }`}
                  data-testid="task-description"
                >
                  {description}
                </p>
              ) : isAgency ? (
                <button
                  onClick={() => setDescEditing(true)}
                  className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] italic"
                >
                  Add a description...
                </button>
              ) : null}

              {/* Comments */}
              <div className="pt-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2">
                  Comments
                </h3>
                <CommentsSection
                  targetType="task"
                  targetId={task.id}
                  commentCount={task._count?.comments ?? 0}
                  alwaysExpanded
                />
              </div>
            </div>

            {/* Sidebar */}
            <aside className="border-t md:border-t-0 md:border-l border-[var(--border)] p-5 space-y-4 bg-[var(--muted)]/30 text-sm">
              {/* Status */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                  Status
                </label>
                {isAgency ? (
                  <select
                    value={status}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    disabled={saving}
                    className="w-full px-2 py-1.5 border border-[var(--border)] rounded bg-[var(--background)] text-sm cursor-pointer"
                    data-testid="task-status-select"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${statusOption.color}`}>
                    {statusOption.label}
                  </span>
                )}
              </div>

              {/* Assignee */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                  Assignee
                </label>
                {isAgency && members ? (
                  <select
                    value={assigneeId}
                    onChange={(e) => handleAssigneeChange(e.target.value)}
                    disabled={saving}
                    className="w-full px-2 py-1.5 border border-[var(--border)] rounded bg-[var(--background)] text-sm cursor-pointer"
                    data-testid="task-assignee-select"
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.user.name}
                      </option>
                    ))}
                  </select>
                ) : task.assignee ? (
                  <div className="flex items-center gap-2">
                    <Avatar name={task.assignee.name} image={task.assignee.image} size={20} />
                    <span>{task.assignee.name}</span>
                  </div>
                ) : (
                  <span className="text-[var(--muted-foreground)]">Unassigned</span>
                )}
              </div>

              {/* Due date */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                  Due date
                </label>
                {isAgency && dueEditing ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      autoFocus
                      className="flex-1 min-w-0 px-2 py-1 border border-[var(--border)] rounded bg-[var(--background)] text-sm"
                    />
                    <button
                      onClick={handleSaveDueDate}
                      disabled={saving}
                      className="p-1 text-[var(--primary)]"
                      aria-label="Save"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={() => {
                        setDueDate(task.dueDate ? task.dueDate.split("T")[0] : "");
                        setDueEditing(false);
                      }}
                      className="p-1 text-[var(--muted-foreground)]"
                      aria-label="Cancel"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => isAgency && setDueEditing(true)}
                    disabled={!isAgency}
                    className={`text-sm ${
                      isAgency ? "hover:text-[var(--foreground)]" : "cursor-default"
                    } ${dueDate ? "" : "text-[var(--muted-foreground)] italic"}`}
                  >
                    {dueDate
                      ? new Date(dueDate).toLocaleDateString()
                      : isAgency
                        ? "Set due date"
                        : "None"}
                  </button>
                )}
              </div>

              {/* Labels */}
              {labels && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      Labels
                    </label>
                    {!readOnlyLabels && (
                      <button
                        onClick={() => {
                          setLabelMenuOpen((v) => !v);
                          if (labelMenuOpen) setCreatingLabel(false);
                        }}
                        className="text-xs text-[var(--primary)] hover:underline"
                        aria-expanded={labelMenuOpen}
                      >
                        {labelMenuOpen ? "Done" : "Edit"}
                      </button>
                    )}
                  </div>
                  {assignedLabelObjects.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {assignedLabelObjects.map((l) => (
                        <LabelBadge key={l.id} name={l.name} color={l.color} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--muted-foreground)] italic">None</p>
                  )}
                  {labelMenuOpen && !readOnlyLabels && (
                    <div className="mt-2 border border-[var(--border)] rounded-lg bg-[var(--background)] overflow-hidden">
                      <div className="max-h-40 overflow-y-auto py-1">
                        {labels.length === 0 && !creatingLabel && (
                          <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
                            No labels yet.
                          </p>
                        )}
                        {labels.map((l) => {
                          const checked = assignedLabels.includes(l.id);
                          return (
                            <button
                              key={l.id}
                              onClick={() => handleToggleLabel(l.id)}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--muted)] transition-colors text-left"
                            >
                              <span
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: l.color }}
                              />
                              <span className="flex-1 truncate">{l.name}</span>
                              <span
                                className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                                  checked
                                    ? "bg-[var(--primary)] border-[var(--primary)] text-white"
                                    : "border-[var(--border)]"
                                }`}
                              >
                                {checked && "\u2713"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {creatingLabel ? (
                        <div className="border-t border-[var(--border)] px-3 py-2 space-y-2">
                          <input
                            type="text"
                            value={newLabelName}
                            onChange={(e) => setNewLabelName(e.target.value)}
                            placeholder="Label name"
                            maxLength={50}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleCreateLabel();
                              if (e.key === "Escape") {
                                setCreatingLabel(false);
                                setLabelError("");
                              }
                            }}
                            className="w-full px-2 py-1 border border-[var(--border)] rounded bg-[var(--background)] text-sm"
                          />
                          <ColorPatchGrid value={newLabelColor} onChange={setNewLabelColor} />
                          {labelError && <p className="text-xs text-red-500">{labelError}</p>}
                          <div className="flex gap-1.5">
                            <button
                              onClick={handleCreateLabel}
                              disabled={!newLabelName.trim() || savingLabel}
                              className="flex-1 px-2 py-1 bg-[var(--primary)] text-white rounded text-xs font-medium disabled:opacity-50"
                            >
                              {savingLabel ? "Creating..." : "Create"}
                            </button>
                            <button
                              onClick={() => {
                                setCreatingLabel(false);
                                setLabelError("");
                              }}
                              className="px-2 py-1 border border-[var(--border)] rounded text-xs"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setCreatingLabel(true)}
                          className="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors border-t border-[var(--border)]"
                        >
                          <Plus size={12} />
                          Create new label
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Requester */}
              {task.requester && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                    Requested by
                  </label>
                  <div className="flex items-center gap-2">
                    <Avatar name={task.requester.name} image={task.requester.image} size={20} />
                    <span>{task.requester.name}</span>
                    {task.isClientRequest && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                        Client
                      </span>
                    )}
                  </div>
                  {task.createdAt && (
                    <p className="text-xs text-[var(--muted-foreground)] mt-1">
                      {new Date(task.createdAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )}

              {/* Client cancel */}
              {canCancel && (
                <button
                  onClick={handleCancelClient}
                  className="w-full px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 transition-colors"
                >
                  Cancel request
                </button>
              )}
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
