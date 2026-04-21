export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";

export const TASK_STATUS_BADGE: Record<TaskStatus, string> = {
  open: "bg-gray-500/15 text-gray-700 dark:text-gray-300",
  in_progress: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
  done: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-rose-500/20 text-rose-700 dark:text-rose-300",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  done: "Done",
  cancelled: "Cancelled",
};

export const TASK_STATUS_OPTIONS: { value: TaskStatus; label: string; color: string }[] = [
  { value: "open", label: TASK_STATUS_LABEL.open, color: TASK_STATUS_BADGE.open },
  { value: "in_progress", label: TASK_STATUS_LABEL.in_progress, color: TASK_STATUS_BADGE.in_progress },
  { value: "done", label: TASK_STATUS_LABEL.done, color: TASK_STATUS_BADGE.done },
  { value: "cancelled", label: TASK_STATUS_LABEL.cancelled, color: TASK_STATUS_BADGE.cancelled },
];

export function getTaskStatusBadge(status: string): string {
  return TASK_STATUS_BADGE[status as TaskStatus] ?? TASK_STATUS_BADGE.open;
}

export function getTaskStatusLabel(status: string): string {
  return TASK_STATUS_LABEL[status as TaskStatus] ?? status;
}
