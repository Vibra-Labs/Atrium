"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import { Trash2, Pencil, CheckSquare, Square, ListTodo } from "lucide-react";
import { track } from "@/lib/track";

interface TaskRecord {
  id: string;
  title: string;
  description?: string;
  dueDate?: string | null;
  completed: boolean;
  order: number;
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
        <div className="flex gap-2 mb-3">
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
      )}

      <div className="space-y-1">
        {tasks.map((task) => (
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
        ))}
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
