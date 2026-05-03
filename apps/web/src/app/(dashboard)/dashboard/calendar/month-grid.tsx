"use client";

import { useMemo, useState } from "react";
import { gridDays, groupByDate, isSameDay, toISODate } from "./types";
import type { CalendarEvent } from "./types";
import { EventChip } from "./event-chip";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_VISIBLE = 3;

export function MonthGrid({ month, events }: { month: Date; events: CalendarEvent[] }) {
  const [popoverDate, setPopoverDate] = useState<string | null>(null);
  const days = useMemo(() => gridDays(month), [month]);
  const today = new Date();
  const byDate = useMemo(() => groupByDate(events), [events]);

  return (
    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 border-b border-[var(--border)]">
        {WEEKDAYS.map((w, i) => {
          const isWeekend = i === 0 || i === 6;
          return (
            <div
              key={w}
              className={`py-2.5 text-center text-[11px] font-semibold tracking-wide uppercase ${isWeekend ? "text-[var(--muted-foreground)]/60" : "text-[var(--muted-foreground)]"}`}
            >
              {w}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, idx) => {
          const iso = toISODate(d);
          const inMonth = d.getMonth() === month.getMonth();
          const dayOfWeek = d.getDay();
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          const col = idx % 7;
          const row = Math.floor(idx / 7);
          const isLastCol = col === 6;
          const isLastRow = row === Math.floor((days.length - 1) / 7);
          const borders = `${isLastCol ? "" : "border-r"} ${isLastRow ? "" : "border-b"} border-[var(--border)]`;

          if (!inMonth) {
            return (
              <div
                key={iso}
                className={`min-h-[110px] ${borders} bg-[var(--muted)]/20`}
              />
            );
          }

          const isToday = isSameDay(d, today);
          const dayEvents = byDate.get(iso) ?? [];
          const visible = dayEvents.slice(0, MAX_VISIBLE);
          const overflow = dayEvents.length - visible.length;

          return (
            <div
              key={iso}
              className={`min-h-[110px] ${borders} p-1.5 flex flex-col gap-1 transition-colors hover:bg-[var(--muted)]/40 ${isWeekend ? "bg-[var(--muted)]/10" : ""}`}
            >
              <div className="flex justify-end pr-0.5">
                {isToday ? (
                  <span className="w-6 h-6 inline-flex items-center justify-center rounded-full bg-[var(--primary)] text-white text-[11px] font-semibold">
                    {d.getDate()}
                  </span>
                ) : (
                  <span className={`text-[11px] font-medium px-1 ${isWeekend ? "text-[var(--muted-foreground)]/60" : "text-[var(--muted-foreground)]"}`}>
                    {d.getDate()}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                {visible.map((e) => (
                  <EventChip key={`${e.type}-${e.id}-${e.date}`} event={e} />
                ))}
                {overflow > 0 && (
                  <button
                    onClick={() => setPopoverDate(iso)}
                    className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors text-left px-1.5 py-0.5 rounded hover:bg-[var(--muted)]"
                  >
                    +{overflow} more
                  </button>
                )}
              </div>
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
