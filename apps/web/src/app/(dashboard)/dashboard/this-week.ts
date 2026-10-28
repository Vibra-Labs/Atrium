import type { CalendarEvent } from "@atrium/shared";
import { toISODate } from "./calendar/types";

const CLOSED_TASK_STATUSES = new Set(["done", "cancelled"]);
const OPEN_INVOICE_STATUSES = new Set(["sent", "overdue"]);

/** Today through six days from now, as calendar date keys. */
export function thisWeekRange(now: Date): { from: string; to: string } {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6);
  return { from: toISODate(now), to: toISODate(end) };
}

/** The deadlines still worth acting on: open tasks, project deadlines and unpaid invoices. */
export function thisWeekItems(events: CalendarEvent[], limit = 6): CalendarEvent[] {
  return events
    .filter((e) => {
      if (e.type === "task") return !CLOSED_TASK_STATUSES.has(e.status);
      if (e.type === "invoice_due") return OPEN_INVOICE_STATUSES.has(e.status);
      return e.type === "project_end";
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);
}
