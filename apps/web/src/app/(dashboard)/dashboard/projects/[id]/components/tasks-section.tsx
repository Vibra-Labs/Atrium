"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import {
  Trash2,
  Vote,
  Lock,
  Download,
  UserCircle,
  MessageSquare,
  Plus,
  ChevronDown,
  CheckSquare,
  Calendar,
  Check,
} from "lucide-react";
import { track } from "@/lib/track";
import { LabelBadge } from "@/components/label-badge";
import { Avatar } from "@/components/avatar";
import {
  TaskDetailModal,
  type TaskDetailLabel,
} from "@/components/task-detail-modal";
import { downloadCsv } from "@/lib/download";
import { getTaskStatusBadge, getTaskStatusLabel } from "@/lib/task-status";
import { useCachedApi } from "@/lib/cached";

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

export function TasksSection({
  projectId,
  isArchived,
  onGoToFiles,
}: {
  projectId: string;
  isArchived: boolean;
  onGoToFiles?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const labels: TaskDetailLabel[] = useCachedApi<TaskDetailLabel[]>("/labels") ?? [];
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [taskType, setTaskType] = useState<"checkbox" | "decision">("checkbox");
  const [creating, setCreating] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const [newQuestion, setNewQuestion] = useState("");
  const [newOptions, setNewOptions] = useState<string[]>(["", ""]);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const [otherCount, setOtherCount] = useState<number>(0);
  const loadTasks = useCallback(() => {
    apiFetch<PaginatedResponse<TaskRecord>>(
      `/tasks/project/${projectId}?page=${page}&limit=20&status=${statusFilter}`,
    )
      .then(async (res) => {
        setTasks(res.data);
        setTotalPages(res.meta.totalPages);
        // An empty Active list may still hide done or cancelled tasks.
        if (statusFilter === "active" && res.data.length === 0) {
          const all = await apiFetch<PaginatedResponse<TaskRecord>>(`/tasks/project/${projectId}?limit=1&status=all`);
          setOtherCount(all.meta.total);
        } else {
          setOtherCount(0);
        }
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

  // Deep link: read `?task=<id>` to open modal on mount/URL change
  useEffect(() => {
    const taskParam = searchParams.get("task");
    if (taskParam) setOpenTaskId(taskParam);
  }, [searchParams]);

  // Close the create-type dropdown when clicking outside
  useEffect(() => {
    if (!createMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setCreateMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [createMenuOpen]);

  const startCreating = (type: "checkbox" | "decision") => {
    setTaskType(type);
    setCreating(true);
    setCreateMenuOpen(false);
  };

  const cancelCreating = () => {
    setCreating(false);
    setNewTitle("");
    setNewDueDate("");
    setNewQuestion("");
    setNewOptions(["", ""]);
  };

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
        setCreating(false);
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
        setCreating(false);
        loadTasks();
      } catch (err) {
        showError(err instanceof Error ? err.message : "Failed to add decision task");
      }
    }
  };

  async function toggleDone(task: TaskRecord): Promise<void> {
    try {
      await apiFetch(`/tasks/${task.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: task.status === "done" ? "open" : "done" }),
      });
      loadTasks();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to update the task");
    }
  }

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

  // Keep the open task's record across list refreshes so the detail modal
  // doesn't unmount when a status change filters the task out of the list.
  const [openTaskRecord, setOpenTaskRecord] = useState<TaskRecord | null>(null);
  useEffect(() => {
    if (!openTaskId) {
      setOpenTaskRecord(null);
      return;
    }
    const found = tasks.find((t) => t.id === openTaskId);
    if (found) setOpenTaskRecord(found);
  }, [openTaskId, tasks]);

  /** The small controls in the card header share one size, so they line up. */
  const headerControl: string =
    "h-7 inline-flex items-center rounded-md text-xs font-medium bg-transparent hover:bg-[var(--muted)] cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] transition-colors";
  const quiet: string = "text-[var(--muted-foreground)] hover:text-[var(--foreground)]";
  const showFilters: boolean = tasks.length > 0 || statusFilter !== "active" || otherCount > 0;

  return (
    <section className="p-4 sm:p-5 rounded-2xl bg-[var(--background)] border border-[var(--border)] space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Tasks{tasks.length > 0 && ` (${tasks.length})`}
        </h2>
        <div className="flex items-center gap-1">
          {/* Filters only once there's something to filter. */}
          {showFilters && (
            <select
              aria-label="Show tasks"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              // Tighter than the global dropdown arrow (globals.css), and only as wide as the chosen option.
              style={{
                paddingRight: "1.25rem",
                backgroundPosition: "right 0.25rem center",
                backgroundSize: "0.75rem",
                fieldSizing: "content",
              }}
              className={`pl-2 ${headerControl} ${quiet}`}
            >
              <option value="active">Active</option>
              <option value="all">All</option>
              <option value="done">Done</option>
              <option value="cancelled">Cancelled</option>
            </select>
          )}
          {tasks.length > 0 && (
            <button
              onClick={() => downloadCsv(`/tasks/project/${projectId}/export`)}
              className={`w-7 justify-center ${headerControl} ${quiet}`}
              title="Export tasks as CSV"
              aria-label="Export tasks"
            >
              <Download size={13} />
            </button>
          )}
          {!isArchived && !creating && (
            <div ref={createMenuRef} className="relative inline-block">
              <button
                onClick={() => setCreateMenuOpen((v) => !v)}
                aria-label="Add task"
                className={`gap-1 px-2 ${headerControl} text-[var(--primary)]`}
              >
                <Plus size={13} />
                Add
                <ChevronDown size={12} />
              </button>
              {createMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg z-10 overflow-hidden">
                  <button
                    onClick={() => startCreating("checkbox")}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--muted)] text-left"
                  >
                    <CheckSquare size={14} className="text-[var(--muted-foreground)]" />
                    Task
                  </button>
                  <button
                    onClick={() => startCreating("decision")}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--muted)] text-left"
                  >
                    <Vote size={14} className="text-[var(--muted-foreground)]" />
                    Decision
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!isArchived && creating && (
        <div className="space-y-2">

          {creating && taskType === "checkbox" && (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Add a task..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") cancelCreating();
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
                  onClick={cancelCreating}
                  className="px-3 py-2 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={!newTitle.trim()}
                  className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {creating && taskType === "decision" && (
            <div className="space-y-2 p-3 border border-[var(--border)] rounded-lg">
              <p className="text-xs text-[var(--muted-foreground)]">
                Client votes between options. For sign-off on a file or design, use{" "}
                {onGoToFiles ? (
                  <button type="button" onClick={onGoToFiles} className="underline hover:text-[var(--foreground)]">Files → Request approval</button>
                ) : "Files → Request approval"}.
              </p>
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
                <div className="flex gap-2">
                  <button
                    onClick={cancelCreating}
                    className="px-3 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)]"
                  >
                    Cancel
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
            </div>
          )}
        </div>
      )}

      {tasks.length > 0 ? (
        // Capped and scrollable, so a long list doesn't push the cards below it off the screen.
        <div className="divide-y divide-[var(--border)] max-h-80 overflow-y-auto">
          {tasks.map((task) => {
            if (task.type === "decision") {
              const totalVotes = task.options?.reduce((s, o) => s + o._count.votes, 0) || 0;
              const isClosed = !!task.closedAt;

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
                  className="group px-1 py-2.5 cursor-pointer hover:bg-[var(--muted)]/40 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
                >
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">
                      <Vote size={12} />
                    </span>
                    <span className={`flex-1 text-sm min-w-0 ${isClosed ? "text-[var(--muted-foreground)]" : ""}`}>
                      <span className="break-words">{task.question || task.title}</span>
                      {task.labels && task.labels.length > 0 && (
                        <span className="inline-flex gap-1 ml-2 align-middle">
                          {task.labels.map((l) => (
                            <LabelBadge key={l.label.id} name={l.label.name} color={l.label.color} />
                          ))}
                        </span>
                      )}
                    </span>
                    {isClosed && (
                      <span className="shrink-0 flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                        <Lock size={10} />
                        Closed
                      </span>
                    )}
                    {totalVotes > 0 && (
                      <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                        {totalVotes} vote{totalVotes !== 1 ? "s" : ""}
                      </span>
                    )}
                    {task._count && task._count.comments > 0 && (
                      <span className="shrink-0 flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                        <MessageSquare size={12} />
                        {task._count.comments}
                      </span>
                    )}
                    {!isArchived && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(task.id);
                        }}
                        className="shrink-0 p-1.5 text-[var(--muted-foreground)] hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                        aria-label="Delete decision"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            }

            // Checkbox / request task — clickable row opening the detail modal
            const done: boolean = task.status === "done";
            const strike: boolean = done || task.status === "cancelled";

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
                className="group px-1 py-2.5 cursor-pointer hover:bg-[var(--muted)]/40 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={done}
                    aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} done`}
                    disabled={isArchived || task.status === "cancelled"}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleDone(task);
                    }}
                    className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center disabled:opacity-40 ${
                      done ? "bg-[var(--primary)] border-[var(--primary)] text-white" : "border-[var(--muted-foreground)] hover:border-[var(--primary)]"
                    }`}
                  >
                    {done && <Check size={12} strokeWidth={3} />}
                  </button>

                  <span className="flex-1 text-sm min-w-0">
                    {/* Only the title is struck through, not the badges after it. */}
                    <span className={`break-words ${strike ? "line-through text-[var(--muted-foreground)]" : ""}`}>
                      {task.title}
                    </span>
                    {(task.status === "in_progress" || task.status === "cancelled") && (
                      <span className={`ml-2 text-xs ${getTaskStatusBadge(task.status)} px-1.5 py-0.5 rounded-full`}>
                        {getTaskStatusLabel(task.status)}
                      </span>
                    )}
                    {task.isClientRequest && (
                      <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium align-middle">
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

                  {task.dueDate && (() => {
                    const due = new Date(task.dueDate);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const dueDay = new Date(due);
                    dueDay.setHours(0, 0, 0, 0);
                    const active = task.status !== "done" && task.status !== "cancelled";
                    const overdue = active && dueDay.getTime() < today.getTime();
                    const dueToday = active && dueDay.getTime() === today.getTime();
                    const tone = overdue
                      ? "bg-rose-500/20 text-rose-700 dark:text-rose-300"
                      : dueToday
                        ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                        : "bg-[var(--muted)] text-[var(--muted-foreground)]";
                    return (
                      <span className={`shrink-0 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${tone}`}>
                        <Calendar size={10} />
                        {due.toLocaleDateString()}
                      </span>
                    );
                  })()}

                  <span className="shrink-0" title={task.assignee?.name ?? "Unassigned"}>
                    {task.assignee ? (
                      <Avatar
                        name={task.assignee.name}
                        image={task.assignee.image}
                        size={22}
                      />
                    ) : (
                      <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full border border-dashed border-[var(--border)] text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100">
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
                      className="shrink-0 p-1.5 text-[var(--muted-foreground)] hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                      aria-label="Delete task"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">
          {statusFilter !== "active" ? (
            "No tasks here."
          ) : otherCount > 0 ? (
            <>
              No open tasks.{" "}
              <button onClick={() => { setStatusFilter("all"); setPage(1); }} className="text-[var(--primary)] hover:underline">
                Show all ({otherCount})
              </button>
            </>
          ) : (
            "No tasks yet."
          )}
        </p>
      )}
      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />}

      {openTaskRecord && (
        <TaskDetailModal
          task={openTaskRecord}
          viewer="agency"
          projectId={projectId}
          members={members.map((m) => ({ userId: m.userId, user: m.user }))}
          labels={labels}
          onClose={closeTask}
          onChange={loadTasks}
          onDelete={() => {
            closeTask();
            loadTasks();
          }}
        />
      )}
    </section>
  );
}
