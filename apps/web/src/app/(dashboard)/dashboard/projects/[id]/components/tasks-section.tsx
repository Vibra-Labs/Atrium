"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import {
  Trash2,
  ListTodo,
  Vote,
  Lock,
  Download,
  UserCircle,
  MessageSquare,
} from "lucide-react";
import { track } from "@/lib/track";
import { CommentsSection } from "@/components/comments-section";
import { LabelBadge } from "@/components/label-badge";
import { Avatar } from "@/components/avatar";
import {
  TaskDetailModal,
  type TaskDetailLabel,
} from "@/components/task-detail-modal";
import { downloadCsv } from "@/lib/download";

interface TaskRecord {
  id: string;
  title: string;
  description?: string;
  dueDate?: string | null;
  status: string;
  requestedById?: string | null;
  assigneeId?: string | null;
  requester?: { id: string; name: string; image?: string | null } | null;
  assignee?: { id: string; name: string; image?: string | null } | null;
  isClientRequest: boolean;
  order: number;
  type: string;
  question?: string;
  closedAt?: string | null;
  createdAt?: string;
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
  user: { id: string; name: string; email: string; image?: string | null };
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const STATUS_BADGE: Record<string, string> = {
  open: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
  cancelled: "bg-red-50 text-red-600",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  done: "Done",
  cancelled: "Cancelled",
};

export function TasksSection({
  projectId,
  isArchived,
}: {
  projectId: string;
  isArchived: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [labels, setLabels] = useState<TaskDetailLabel[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [taskType, setTaskType] = useState<"checkbox" | "decision">("checkbox");
  const [newQuestion, setNewQuestion] = useState("");
  const [newOptions, setNewOptions] = useState<string[]>(["", ""]);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

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
    apiFetch<TaskDetailLabel[]>("/labels")
      .then(setLabels)
      .catch(console.error);
  }, []);

  // Deep link: read `?task=<id>` to open modal on mount/URL change
  useEffect(() => {
    const taskParam = searchParams.get("task");
    if (taskParam) setOpenTaskId(taskParam);
  }, [searchParams]);

  const updateTaskInUrl = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("task", id);
      else params.delete("task");
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, searchParams],
  );

  const openTask = (id: string) => {
    setOpenTaskId(id);
    updateTaskInUrl(id);
  };

  const closeTask = () => {
    setOpenTaskId(null);
    updateTaskInUrl(null);
  };

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

  const openTaskRecord = openTaskId ? tasks.find((t) => t.id === openTaskId) : null;

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

          // Checkbox / request task — clickable row opening the detail modal
          const statusBadgeClass = STATUS_BADGE[task.status] ?? STATUS_BADGE.open;
          const statusText = STATUS_LABEL[task.status] ?? task.status;
          const strike = task.status === "done" || task.status === "cancelled";

          return (
            <div
              key={task.id}
              role="button"
              tabIndex={0}
              onClick={() => openTask(task.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openTask(task.id);
                }
              }}
              data-testid={`task-row-${task.id}`}
              className="p-2 border border-[var(--border)] rounded-lg cursor-pointer hover:bg-[var(--muted)]/40 transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusBadgeClass}`}
                >
                  {statusText}
                </span>

                <span
                  className={`flex-1 text-sm min-w-0 ${strike ? "line-through text-[var(--muted-foreground)]" : ""}`}
                >
                  <span className="break-words">{task.title}</span>
                  {task.isClientRequest && (
                    <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium align-middle">
                      <UserCircle size={10} />
                      {task.requester?.name ?? "Client"}
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

                {task._count && task._count.comments > 0 && (
                  <span className="shrink-0 flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                    <MessageSquare size={12} />
                    {task._count.comments}
                  </span>
                )}

                {task.dueDate && (
                  <span className="shrink-0 text-xs px-2 py-0.5 bg-[var(--muted)] rounded-full text-[var(--muted-foreground)]">
                    {new Date(task.dueDate).toLocaleDateString()}
                  </span>
                )}

                <span className="shrink-0" title={task.assignee?.name ?? "Unassigned"}>
                  {task.assignee ? (
                    <Avatar
                      name={task.assignee.name}
                      image={task.assignee.image}
                      size={22}
                    />
                  ) : (
                    <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full border border-dashed border-[var(--border)] text-[var(--muted-foreground)]">
                      <UserCircle size={14} />
                    </span>
                  )}
                </span>

                {!isArchived && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(task.id);
                    }}
                    className="shrink-0 p-1.5 text-[var(--muted-foreground)] hover:text-red-500 transition-colors"
                    aria-label="Delete task"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
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

      {openTaskRecord && (
        <TaskDetailModal
          task={openTaskRecord}
          viewer="agency"
          members={members.map((m) => ({ userId: m.userId, user: m.user }))}
          labels={labels}
          onLabelsChange={setLabels}
          onClose={closeTask}
          onChange={loadTasks}
          onDelete={loadTasks}
        />
      )}
    </div>
  );
}
