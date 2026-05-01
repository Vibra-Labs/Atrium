"use client";

import Link from "next/link";
import { CheckSquare, PlayCircle, StopCircle, Receipt } from "lucide-react";
import type { CalendarEvent } from "./types";

function chipHref(e: CalendarEvent): string {
  if (e.type === "task") return `/dashboard/projects/${e.projectId}?tab=tasks&task=${e.id}`;
  if (e.type === "project_start" || e.type === "project_end") return `/dashboard/projects/${e.projectId}`;
  if (e.type === "invoice_due" && e.projectId) return `/dashboard/projects/${e.projectId}?tab=invoices`;
  return "#";
}

function invoiceColor(status: string): string {
  if (status === "paid") return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900";
  if (status === "overdue") return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900";
  return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900";
}

function taskColor(status: string): string {
  if (status === "done") return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900";
  if (status === "in_progress") return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900";
  return "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700";
}

export function EventChip({ event, compact = false }: { event: CalendarEvent; compact?: boolean }) {
  let icon: React.ReactNode;
  let className: string;
  let label: string;
  let tooltip: string;

  if (event.type === "task") {
    icon = <CheckSquare size={10} />;
    className = taskColor(event.status);
    label = event.title;
    tooltip = `${event.title} · ${event.projectName}${event.assigneeName ? ` · ${event.assigneeName}` : ""}`;
  } else if (event.type === "project_start") {
    icon = <PlayCircle size={10} />;
    className = "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900";
    label = `Start: ${event.title}`;
    tooltip = `Project starts: ${event.title}`;
  } else if (event.type === "project_end") {
    icon = <StopCircle size={10} />;
    className = "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-900";
    label = `End: ${event.title}`;
    tooltip = `Project ends: ${event.title}`;
  } else if (event.type === "invoice_due") {
    icon = <Receipt size={10} />;
    className = invoiceColor(event.status);
    label = event.title;
    tooltip = `Invoice ${event.title} due${event.projectName ? ` · ${event.projectName}` : ""}`;
  } else {
    icon = null;
    className = "";
    label = "";
    tooltip = "";
  }

  return (
    <Link
      href={chipHref(event)}
      title={tooltip}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] truncate hover:opacity-80 ${className} ${compact ? "" : "w-full"}`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}
