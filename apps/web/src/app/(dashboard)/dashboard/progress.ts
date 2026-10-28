interface ProgressInput {
  status: string;
  taskCount?: number;
  completedTaskCount?: number;
}

/** Percent of a project's checkbox tasks that are done, from the counts the project list returns. */
export function projectProgress(project: ProgressInput): number {
  if (project.status === "completed") return 100;
  const total = project.taskCount ?? 0;
  if (total === 0) return 0;
  return Math.round(((project.completedTaskCount ?? 0) / total) * 100);
}
