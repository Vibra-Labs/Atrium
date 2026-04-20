"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import {
  Trash2,
  Pencil,
  ListTodo,
  Vote,
  Lock,
  Download,
  UserCircle,
} from "lucide-react";
import { track } from "@/lib/track";
import { CommentsSection } from "@/components/comments-section";
import { LabelBadge } from "@/components/label-badge";
import { downloadCsv } from "@/lib/download";

interface TaskRecord {
  id: string;
  title: string;
  description?: string;
  dueDate?: string | null;
  status: string;
  requestedById?: string | null;
  assigneeId?: string | null;
  isClientRequest: boolean;
  order: number;
  type: string;
  question?: string;
  closedAt?: string | null;
  options?: {
    id: string;
    label: string;
    order: number;
    _count: { votes: number };
  }[];
  labels?: { label: { id: string; name: string; color: string } }[];
  _count?: { votes: number; comments: number };
}

interface OrgMember {
  userId: string;
  role: string;
  user: { id: string; name: string; email: string };
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const STATUS_OPTIONS = [
  { value: "open", label: "Open", color: "bg-gray-100 text-gray-700" },
  { value: "in_progress", label: "In Progress", color: "bg-blue-100 text-blue-700" },
  { value: "done", label: "Done", color: "bg-green-100 text-green-700" },
  { value: "cancelled", label: "Cancelled", color: "bg-red-50 text-red-600" },
];

export function TasksSection({
  projectId,
  isArchived,
}: {
  projectId: string;
  isArchived: boolean;
}) {
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("active"); // "active" | "all" | "done" | "cancelled"
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDueDate, setEditingDueDate] = useState("");
  const [taskType, setTaskType] = useState<"checkbox" | "decision">("checkbox");
  const [newQuestion, setNewQuestion] = useState("");
  const [newOptions, setNewOptions] = useState<string[]>(["", ""]);

  const loadTasks = useCallback(() => {
    apiFetch<PaginatedResponse<TaskRecord>>(
      `/tasks/project/${projectId}?page=${page}&limit=20&status=${statusFilter}`,
    )
      .then((res) => {
        setTasks(res.data);
        setTotalPages(res.meta.totalPages);
      })
      .catch(console.error);
  }, [projectId, page, statusFilter]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    apiFetch<PaginatedResponse<OrgMember>>("/clients?limit=100")
      .then((res) => setMembers(res.data.filter((m) => m.role === "owner" || m.role === "admin")))
      .catch(console.error);
  }, []);

  const handleAdd = async () => {
    if (taskType === "checkbox") {
      if (!newTitle.trim()) return;
      try {
        await apiFetch(`/tasks?projectId=${projectId}`, {
          method: "POST",
          body: JSON.stringify({
            title: newTitle,
            dueDate: newDueDate || undefined,
          }),
        });
        track("task_created");
        setNewTitle("");
        setNewDueDate("");
        loadTasks();
      } catch (err) {
        showError(err instanceof Error ? err.message : "Failed to add task");
      }
    } else {
      if (!newQuestion.trim() || newOptions.filter((o) => o.trim()).length < 2) return;
      try {
        await apiFetch(`/tasks?projectId=${projectId}`, {
          method: "POST",
          body: JSON.stringify({
            title: newQuestion,
            type: "decision",
            question: newQuestion,
            options: newOptions.filter((o) => o.trim()).map((label) => ({ label })),
          }),
        });
        track("task_created", { type: "decision" });
        setNewQuestion("");
        setNewOptions(["", ""]);
        loadTasks();
      } catch (err) {
        showError(err instanceof Error ? err.message : "Failed to add decision task");
      }
    }
  };

  const handleCloseVoting = async (taskId: string) => {
    try {
      await apiFetch(`/tasks/${taskId}/close`, { method: "POST" });
      loadTasks();
      success("Voting closed");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to close voting");
    }
  };

  const handleStatusChange = async (task: TaskRecord, newStatus: string) => {
    try {
      await apiFetch(`/tasks/${task.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: newStatus }),
      });
      if (newStatus === "done") track("task_completed");
      loadTasks();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update task status");
    }
  };

  const handleAssigneeChange = async (taskId: string, assigneeId: string | null) => {
    try {
      await apiFetch(`/tasks/${taskId}`, {
        method: "PUT",
        body: JSON.stringify({ assigneeId }),
      });
      loadTasks();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update assignee");
    }
  };

  const handleUpdate = async (taskId: string) => {
    try {
      await apiFetch(`/tasks/${taskId}`, {
        method: "PUT",
        body: JSON.stringify({
          title: editingTitle,
          dueDate: editingDueDate || null,
        }),
      });
      setEditingId(null);
      loadTasks();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update task");
    }
  };

  const handleDelete = async (taskId: string) => {
    const ok = await confirm({
      title: "Delete Task",
      message: "Delete this task? This cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/tasks/${taskId}`, { method: "DELETE" });
      loadTasks();
      success("Task deleted");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete task");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">
          Tasks{tasks.length > 0 && ` (${tasks.length})`}
        </h2>
        {tasks.length > 0 && (
          <button
            onClick={() => downloadCsv(`/tasks/project/${projectId}/export`)}
            className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            title="Export tasks as CSV"
          >
            <Download size={13} />
            Export
          </button>
        )}
      </div>

      {/* Status filter bar */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {[
          { key: "active", label: "Active" },
          { key: "all", label: "All" },
          { key: "done", label: "Done" },
          { key: "cancelled", label: "Cancelled" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => { setStatusFilter(f.key); setPage(1); }}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              statusFilter === f.key
                ? "bg-[var(--primary)] text-white"
                : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--border)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!isArchived && (
        <div className="mb-3 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => setTaskType("checkbox")}
              className={`px-3 py-2 rounded-lg text-sm border ${taskType === "checkbox" ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] hover:bg-[var(--muted)]"}`}
            >
              Checkbox
            </button>
            <button
              onClick={() => setTaskType("decision")}
              className={`px-3 py-2 rounded-lg text-sm border ${taskType === "decision" ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] hover:bg-[var(--muted)]"}`}
            >
              Decision
            </button>
          </div>

          {taskType === "checkbox" ? (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Add a task..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
              />
              <div className="flex gap-2">
                <input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                />
                <button
                  onClick={handleAdd}
                  disabled={!newTitle.trim()}
                  className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 p-3 border border-[var(--border)] rounded-lg">
              <input
                type="text"
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                placeholder="Ask a question..."
                className="w-full px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
              />
              <div className="space-y-1">
                {newOptions.map((opt, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) =>
                        setNewOptions((prev) =>
                          prev.map((o, idx) => (idx === i ? e.target.value : o)),
                        )
                      }
                      placeholder={`Option ${i + 1}`}
                      className="flex-1 px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                    />
                    {newOptions.length > 2 && (
                      <button
                        onClick={() => setNewOptions((prev) => prev.filter((_, idx) => idx !== i))}
                        className="p-1.5 text-[var(--muted-foreground)] hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setNewOptions((prev) => [...prev, ""])}
                  disabled={newOptions.length >= 5}
                  className="text-sm text-[var(--primary)] hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
                >
                  + Add Option
                </button>
                <button
                  onClick={handleAdd}
                  disabled={!newQuestion.trim() || newOptions.filter((o) => o.trim()).length < 2}
                  className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
                >
                  Add Decision
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1">
        {tasks.map((task) => {
          if (task.type === "decision") {
            const totalVotes = task.options?.reduce((s, o) => s + o._count.votes, 0) || 0;
            const isClosed = !!task.closedAt;

            return (
              <div
                key={task.id}
                className={`p-3 border border-[var(--border)] rounded-lg space-y-2 ${isClosed ? "opacity-75" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Vote size={16} className="text-[var(--primary)] shrink-0" />
                    <span className={`text-sm font-medium break-words ${isClosed ? "line-through text-[var(--muted-foreground)]" : ""}`}>
                      {task.question || task.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isClosed ? (
                      <span className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                        <Lock size={12} />
                        Closed
                      </span>
                    ) : (
                      !isArchived && (
                        <button
                          onClick={() => handleCloseVoting(task.id)}
                          className="flex items-center gap-1 px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--muted)]"
                        >
                          <Lock size={12} />
                          Close Voting
                        </button>
                      )
                    )}
                    {!isArchived && (
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="p-2 text-[var(--muted-foreground)] hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  {task.options?.map((opt) => {
                    const pct = totalVotes > 0 ? (opt._count.votes / totalVotes) * 100 : 0;
                    return (
                      <div key={opt.id} className="relative">
                        <div
                          className="absolute inset-0 rounded bg-[var(--primary)] opacity-10"
                          style={{ width: `${pct}%` }}
                        />
                        <div className="relative flex items-center justify-between px-3 py-1.5 text-sm">
                          <span>{opt.label}</span>
                          <span className="text-xs text-[var(--muted-foreground)]">
                            {opt._count.votes} vote{opt._count.votes !== 1 ? "s" : ""} ({Math.round(pct)}%)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {totalVotes > 0 && (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {totalVotes} total vote{totalVotes !== 1 ? "s" : ""}
                  </p>
                )}
                <CommentsSection
                  targetType="task"
                  targetId={task.id}
                  commentCount={task._count?.comments ?? 0}
                />
              </div>
            );
          }

          // Checkbox / request task
          return (
            <div
              key={task.id}
              className="p-2 border border-[var(--border)] rounded-lg"
            >
              <div className="flex items-center gap-2">
                {/* Status dropdown */}
                <select
                  value={task.status}
                  disabled={isArchived}
                  onChange={(e) => handleStatusChange(task, e.target.value)}
                  className="shrink-0 text-xs border border-[var(--border)] rounded bg-[var(--background)] px-1 py-0.5 cursor-pointer disabled:opacity-50"
                  title="Change status"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>

                {editingId === task.id ? (
                  <div className="flex-1 flex flex-col gap-2 min-w-0">
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleUpdate(task.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                      className="w-full px-2 py-1.5 border border-[var(--border)] rounded bg-[var(--background)] text-sm"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={editingDueDate}
                        onChange={(e) => setEditingDueDate(e.target.value)}
                        className="flex-1 min-w-0 px-2 py-1.5 border border-[var(--border)] rounded bg-[var(--background)] text-sm"
                      />
                      <button
                        onClick={() => handleUpdate(task.id)}
                        className="px-3 py-1.5 text-sm text-[var(--primary)] hover:underline"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-1 py-1.5 text-sm text-[var(--muted-foreground)] hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span
                      className={`flex-1 text-sm ${task.status === "done" || task.status === "cancelled" ? "line-through text-[var(--muted-foreground)]" : ""}`}
                    >
                      {task.title}
                      {task.isClientRequest && (
                        <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium align-middle">
                          <UserCircle size={10} />
                          Client
                        </span>
                      )}
                      {task.labels && task.labels.length > 0 && (
                        <span className="inline-flex gap-1 ml-2 align-middle">
                          {task.labels.map((l) => (
                            <LabelBadge key={l.label.id} name={l.label.name} color={l.label.color} />
                          ))}
                        </span>
                      )}
                    </span>
                    {task.dueDate && (
                      <span className="text-xs px-2 py-0.5 bg-[var(--muted)] rounded-full text-[var(--muted-foreground)]">
                        {new Date(task.dueDate).toLocaleDateString()}
                      </span>
                    )}
                    {/* Assignee picker */}
                    {!isArchived && members.length > 0 && (
                      <select
                        value={task.assigneeId ?? ""}
                        onChange={(e) =>
                          handleAssigneeChange(task.id, e.target.value || null)
                        }
                        className="text-xs border border-[var(--border)] rounded bg-[var(--background)] px-1 py-0.5 max-w-[120px] truncate cursor-pointer"
                        title="Assign to"
                      >
                        <option value="">Unassigned</option>
                        {members.map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.user.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {!isArchived && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => {
                            setEditingId(task.id);
                            setEditingTitle(task.title);
                            setEditingDueDate(task.dueDate ? task.dueDate.split("T")[0] : "");
                          }}
                          className="p-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(task.id)}
                          className="p-2 text-[var(--muted-foreground)] hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
              <CommentsSection
                targetType="task"
                targetId={task.id}
                commentCount={task._count?.comments ?? 0}
              />
            </div>
          );
        })}
        {tasks.length === 0 && (
          <div className="text-center py-6">
            <ListTodo size={32} className="mx-auto text-[var(--muted-foreground)] mb-2" />
            <p className="text-sm text-[var(--muted-foreground)]">
              {statusFilter === "active" ? "No active tasks." : "No tasks."}
            </p>
          </div>
        )}
      </div>
      <div className="mt-3">
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </div>
  );
}
