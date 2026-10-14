export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Weekday (0 = Sunday) and hour in the zone, falling back to UTC for an unset or bad zone. */
export function localClock(now: Date, timeZone: string | null | undefined): { weekday: number; hour: number } {
  const zone: string = timeZone && isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday: number = WEEKDAYS.indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
  const hour: number = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return { weekday, hour };
}

/** True once it is the target weekday and at or past the target hour, as the zone sees it. */
export function hasReachedLocalTime(now: Date, timeZone: string | null | undefined, weekday: number, hour: number): boolean {
  const local = localClock(now, timeZone);
  return local.weekday === weekday && local.hour >= hour;
}
