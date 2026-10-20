/**
 * Follow-ups are calendar dates. The API stores them as noon UTC of the date, so the UTC date of
 * the stored value is the follow-up day in every time zone.
 */

/** Stored ISO timestamp -> "YYYY-MM-DD" follow-up day ("" when unset). */
export function followUpDay(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

/** The user's local calendar date as "YYYY-MM-DD". */
export function localToday(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export type FollowUpWhen = "overdue" | "today" | "upcoming";

export function followUpWhen(iso: string, now: Date = new Date()): FollowUpWhen {
  const day = followUpDay(iso);
  const today = localToday(now);
  if (day < today) return "overdue";
  return day === today ? "today" : "upcoming";
}

/** "Nov 19" for the follow-up day. */
export function formatFollowUpDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
