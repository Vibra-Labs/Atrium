"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { CalendarEvent } from "@atrium/shared";
import { apiFetch } from "@/lib/api";
import { thisWeekItems, thisWeekRange } from "./this-week";

const KIND_LABEL: Record<CalendarEvent["type"], string> = {
  task: "Task due",
  project_start: "Project starts",
  project_end: "Project deadline",
  invoice_due: "Invoice due",
};

function eventHref(e: CalendarEvent): string {
  if (!e.projectId) return "/dashboard/calendar";
  const tab = e.type === "invoice_due" ? "?tab=invoices" : e.type === "task" ? "?tab=tasks" : "";
  return `/dashboard/projects/${e.projectId}${tab}`;
}

/** Deadlines in the next seven days, from the same source as the calendar page. */
export function ThisWeekCard(): React.ReactElement {
  const [items, setItems] = useState<CalendarEvent[] | null>(null);

  useEffect(() => {
    const { from, to } = thisWeekRange(new Date());
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // activeOnly: skip archived projects and deadlines of projects that are already done.
    const params = new URLSearchParams({ from, to, tz, activeOnly: "true" });
    apiFetch<CalendarEvent[]>(`/calendar?${params.toString()}`)
      .then((events) => setItems(thisWeekItems(events)))
      .catch((err: unknown) => {
        console.error("Failed to load this week's deadlines", err);
        setItems([]);
      });
  }, []);

  return (
    <section className="p-4 sm:p-5 border border-[var(--border)] rounded-2xl bg-[var(--background)] space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm sm:text-base font-semibold text-[var(--foreground)]">This week</h2>
        <Link
          href="/dashboard/calendar"
          className="text-xs font-semibold text-[var(--primary)] hover:underline flex items-center gap-1"
        >
          <span>Calendar</span>
          <ChevronRight size={13} />
        </Link>
      </div>

      {items === null ? null : items.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)] py-2">No deadlines in the next seven days.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((e) => {
            // Date keys are already in the viewer's timezone; build a local date so the day doesn't shift.
            const [y, m, d] = e.date.split("-").map(Number);
            const day = new Date(y, m - 1, d);
            return (
              <li key={`${e.type}-${e.id}`} className="flex items-center gap-3">
                <div className="w-11 py-1 text-center rounded-lg bg-[var(--muted)] shrink-0 border border-[var(--border)]">
                  <span className="block text-[10px] font-medium text-[var(--muted-foreground)] leading-none">
                    {day.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}
                  </span>
                  <span className="block text-sm font-bold text-[var(--foreground)] leading-tight mt-0.5">
                    {day.getDate()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={eventHref(e)}
                    className="block text-xs font-semibold text-[var(--foreground)] hover:text-[var(--primary)] truncate transition-colors"
                  >
                    {e.title}
                  </Link>
                  <span className="block text-[11px] text-[var(--muted-foreground)] truncate mt-0.5">
                    {KIND_LABEL[e.type]}
                    {e.type !== "project_end" && e.projectName ? ` · ${e.projectName}` : ""}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
