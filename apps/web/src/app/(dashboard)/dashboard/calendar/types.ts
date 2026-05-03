export {
  CALENDAR_EVENT_TYPES as ALL_TYPES,
  type CalendarEvent,
  type CalendarEventType,
} from "@atrium/shared";

import type { CalendarEvent } from "@atrium/shared";

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function gridStart(month: Date): Date {
  const start = startOfMonth(month);
  const day = start.getDay();
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() - day);
}

export function gridEnd(month: Date): Date {
  const end = endOfMonth(month);
  const day = end.getDay();
  return new Date(end.getFullYear(), end.getMonth(), end.getDate() + (6 - day));
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function gridDays(month: Date): Date[] {
  const start = gridStart(month);
  const end = gridEnd(month);
  const days: Date[] = [];
  // Use indexed Date construction (not setDate mutation) to avoid DST drift.
  for (let i = 0; ; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (d > end) break;
    days.push(d);
  }
  return days;
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function groupByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const arr = byDate.get(e.date) ?? [];
    arr.push(e);
    byDate.set(e.date, arr);
  }
  return byDate;
}
