"use client";

import { useState } from "react";
import { gridDays, isSameDay, toISODate } from "./types";
import type { CalendarEvent } from "./types";
import { EventChip } from "./event-chip";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_VISIBLE = 3;

export function MonthGrid({ month, events }: { month: Date; events: CalendarEvent[] }) {
  const [popoverDate, setPopoverDate] = useState<string | null>(null);
  const days = gridDays(month);
  const today = new Date();

  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const arr = byDate.get(e.date) ?? [];
    arr.push(e);
    byDate.set(e.date, arr);
  }

  return (
    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 bg-[var(--muted)] text-xs font-medium">
        {WEEKDAYS.map((w) => (
          <div key={w} className="p-2 text-center">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const iso = toISODate(d);
          const inMonth = d.getMonth() === month.getMonth();
          const isToday = isSameDay(d, today);
          const dayEvents = byDate.get(iso) ?? [];
          const visible = dayEvents.slice(0, MAX_VISIBLE);
          const overflow = dayEvents.length - visible.length;

          return (
            <div
              key={iso}
              className={`min-h-[110px] border-t border-l border-[var(--border)] p-1 flex flex-col gap-1 ${inMonth ? "" : "bg-[var(--muted)]/40 text-[var(--muted-foreground)]"}`}
            >
              <div className={`text-xs px-1 ${isToday ? "inline-flex w-6 h-6 items-center justify-center rounded-full bg-[var(--primary)] text-white font-medium" : ""}`}>
                {d.getDate()}
              </div>
              {visible.map((e) => (
                <EventChip key={`${e.type}-${e.id}-${e.date}`} event={e} />
              ))}
              {overflow > 0 && (
                <button
                  onClick={() => setPopoverDate(iso)}
                  className="text-[11px] text-[var(--muted-foreground)] hover:underline text-left px-1"
                >
                  +{overflow} more
                </button>
              )}
            </div>
          );
        })}
      </div>

      {popoverDate && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setPopoverDate(null); }}
        >
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-sm p-4 space-y-2">
            <div className="text-sm font-medium">{popoverDate}</div>
            <div className="space-y-1">
              {(byDate.get(popoverDate) ?? []).map((e) => (
                <EventChip key={`${e.type}-${e.id}-${e.date}-pop`} event={e} />
              ))}
            </div>
            <div className="text-right pt-2">
              <button onClick={() => setPopoverDate(null)} className="text-sm px-3 py-1 border border-[var(--border)] rounded">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
