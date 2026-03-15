"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import { Trash2, Pencil, CheckSquare, Square, ListTodo, Vote, Lock } from "lucide-react";
import { track } from "@/lib/track";

interface TaskRecord {
  id: string;
  title: string;
  description?: string;
  dueDate?: string | null;
  completed: boolean;
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
  _count?: { votes: number };
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

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
      `/tasks/project/${projectId}?page=${page}&limit=20`,
    )
      .then((res) => {
        setTasks(res.data);
        setTotalPages(res.meta.totalPages);
      })
      .catch(console.error);
  }, [projectId, page]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

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

  const handleToggle = async (task: TaskRecord) => {
    try {
      await apiFetch(`/tasks/${task.id}`, {
        method: "PUT",
        body: JSON.stringify({ completed: !task.completed }),
      });
      if (!task.completed) track("task_completed");
      loadTasks();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update task");
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
      <h2 className="text-sm font-medium mb-3">
        Tasks{tasks.length > 0 && ` (${tasks.length})`}
      </h2>

      {!isArchived && (
        <div className="mb-3 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => setTaskType("checkbox")}
              className={`px-3 py-1 rounded-lg text-sm border ${taskType === "checkbox" ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] hover:bg-[var(--muted)]"}`}
            >
              Checkbox
            </button>
            <button
              onClick={() => setTaskType("decision")}
              className={`px-3 py-1 rounded-lg text-sm border ${taskType === "decision" ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] hover:bg-[var(--muted)]"}`}
            >
              Decision
            </button>
          </div>

          {taskType === "checkbox" ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Add a task..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                className="flex-1 px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
              />
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
              />
              <button
                onClick={handleAdd}
                disabled={!newTitle.trim()}
                className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
              >
                Add
              </button>
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Vote size={16} className="text-[var(--primary)]" />
                    <span className={`text-sm font-medium ${isClosed ? "line-through text-[var(--muted-foreground)]" : ""}`}>
                      {task.question || task.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isClosed ? (
                      <span className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                        <Lock size={12} />
                        Closed
                      </span>
                    ) : (
                      !isArchived && (
                        <button
                          onClick={() => handleCloseVoting(task.id)}
                          className="flex items-center gap-1 px-2 py-1 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--muted)]"
                        >
                          <Lock size={12} />
                          Close Voting
                        </button>
                      )
                    )}
                    {!isArchived && (
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="p-1 text-[var(--muted-foreground)] hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={12} />
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
              </div>
            );
          }

          return (
          <div
            key={task.id}
            className="flex items-center gap-2 p-2 border border-[var(--border)] rounded-lg"
          >
            <button
              onClick={() => handleToggle(task)}
              disabled={isArchived}
              className="shrink-0 text-[var(--primary)] disabled:opacity-50"
            >
              {task.completed ? <CheckSquare size={18} /> : <Square size={18} />}
            </button>

            {editingId === task.id ? (
              <div className="flex-1 flex items-center gap-2">
                <input
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleUpdate(task.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  autoFocus
                  className="flex-1 px-2 py-1 border border-[var(--border)] rounded bg-[var(--background)] text-sm"
                />
                <input
                  type="date"
                  value={editingDueDate}
                  onChange={(e) => setEditingDueDate(e.target.value)}
                  className="px-2 py-1 border border-[var(--border)] rounded bg-[var(--background)] text-sm"
                />
                <button
                  onClick={() => handleUpdate(task.id)}
                  className="text-sm text-[var(--primary)] hover:underline"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="text-sm text-[var(--muted-foreground)] hover:underline"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <span
                  className={`flex-1 text-sm ${task.completed ? "line-through text-[var(--muted-foreground)]" : ""}`}
                >
                  {task.title}
                </span>
                {task.dueDate && (
                  <span className="text-xs px-2 py-0.5 bg-[var(--muted)] rounded-full text-[var(--muted-foreground)]">
                    {new Date(task.dueDate).toLocaleDateString()}
                  </span>
                )}
                {!isArchived && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditingId(task.id);
                        setEditingTitle(task.title);
                        setEditingDueDate(task.dueDate ? task.dueDate.split("T")[0] : "");
                      }}
                      className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(task.id)}
                      className="p-1 text-[var(--muted-foreground)] hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          );
        })}
        {tasks.length === 0 && (
          <div className="text-center py-6">
            <ListTodo size={32} className="mx-auto text-[var(--muted-foreground)] mb-2" />
            <p className="text-sm text-[var(--muted-foreground)]">
              No tasks yet.
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
