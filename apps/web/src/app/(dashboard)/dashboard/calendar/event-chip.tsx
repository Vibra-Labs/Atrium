"use client";

import Link from "next/link";
import { CheckSquare, PlayCircle, StopCircle, Receipt } from "lucide-react";
import { TASK_STATUSES } from "@atrium/shared";
import type { CalendarEvent, CalendarEventType } from "./types";

function chipHref(e: CalendarEvent): string {
  if (e.type === "task") return `/dashboard/projects/${e.projectId}?tab=tasks&task=${e.id}`;
  if (e.type === "project_start" || e.type === "project_end") return `/dashboard/projects/${e.projectId}`;
  if (e.type === "invoice_due" && e.projectId) return `/dashboard/projects/${e.projectId}?tab=invoices`;
  return "#";
}

const STRIPE: Record<CalendarEventType, string> = {
  task: "border-l-blue-500 bg-blue-500/8",
  project_start: "border-l-emerald-500 bg-emerald-500/8",
  project_end: "border-l-violet-500 bg-violet-500/8",
  invoice_due: "border-l-amber-500 bg-amber-500/8",
};

const ICON_COLOR: Record<CalendarEventType, string> = {
  task: "text-blue-600 dark:text-blue-400",
  project_start: "text-emerald-600 dark:text-emerald-400",
  project_end: "text-violet-600 dark:text-violet-400",
  invoice_due: "text-amber-600 dark:text-amber-400",
};

export function EventChip({ event, compact = false }: { event: CalendarEvent; compact?: boolean }) {
  let icon: React.ReactNode;
  let label: string;
  let tooltip: string;
  let muted = false;

  if (event.type === "task") {
    icon = <CheckSquare size={11} />;
    label = event.title;
    tooltip = `${event.title} · ${event.projectName}${event.assigneeName ? ` · ${event.assigneeName}` : ""}`;
    muted = event.status === TASK_STATUSES.DONE;
  } else if (event.type === "project_start") {
    icon = <PlayCircle size={11} />;
    label = `Start: ${event.title}`;
    tooltip = `Project starts: ${event.title}`;
  } else if (event.type === "project_end") {
    icon = <StopCircle size={11} />;
    label = `End: ${event.title}`;
    tooltip = `Project ends: ${event.title}`;
  } else if (event.type === "invoice_due") {
    icon = <Receipt size={11} />;
    label = event.title;
    tooltip = `Invoice ${event.title} due${event.projectName ? ` · ${event.projectName}` : ""}`;
    muted = event.status === "paid";
  } else {
    icon = null;
    label = "";
    tooltip = "";
  }

  const stripe = STRIPE[event.type];
  const iconColor = ICON_COLOR[event.type];

  return (
    <Link
      href={chipHref(event)}
      title={tooltip}
      className={`flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-sm border-l-[3px] text-[11px] leading-tight truncate transition-all hover:brightness-95 dark:hover:brightness-110 ${stripe} ${compact ? "" : "w-full"} ${muted ? "opacity-50" : ""}`}
    >
      <span className={`shrink-0 ${iconColor}`}>{icon}</span>
      <span className={`truncate text-[var(--foreground)] ${muted ? "line-through" : ""}`}>{label}</span>
    </Link>
  );
}
