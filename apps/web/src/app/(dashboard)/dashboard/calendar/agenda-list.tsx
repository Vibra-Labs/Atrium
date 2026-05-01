"use client";

import type { CalendarEvent } from "./types";
import { EventChip } from "./event-chip";

export function AgendaList({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="border border-[var(--border)] rounded-lg p-8 text-center text-sm text-[var(--muted-foreground)]">
        No items in this window.
      </div>
    );
  }

  const grouped = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const arr = grouped.get(e.date) ?? [];
    arr.push(e);
    grouped.set(e.date, arr);
  }

  const dates = Array.from(grouped.keys()).sort();

  return (
    <div className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
      {dates.map((date) => {
        const items = grouped.get(date) ?? [];
        const display = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
          weekday: "short", month: "short", day: "numeric", year: "numeric",
        });
        return (
          <div key={date} className="p-3 space-y-2">
            <div className="text-xs font-medium text-[var(--muted-foreground)] sticky top-0 bg-[var(--background)] py-1">
              {display}
            </div>
            <div className="space-y-1">
              {items.map((e) => (
                <EventChip key={`${e.type}-${e.id}-${e.date}-agenda`} event={e} compact />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
