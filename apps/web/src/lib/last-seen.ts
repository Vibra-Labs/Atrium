const DAY_MS: number = 24 * 60 * 60 * 1000;

/** Short label for when a member last used the app, shown on a client contact's portal access. */
export function formatLastSeen(lastSeenAt: string | null | undefined, now: Date = new Date()): string {
  // Visits are recorded from this release on, so a missing value is not proof of "never".
  if (!lastSeenAt) return "No visits recorded yet";
  const days: number = Math.floor((now.getTime() - new Date(lastSeenAt).getTime()) / DAY_MS);
  if (days < 1) return "Active today";
  if (days === 1) return "Last seen yesterday";
  return `Last seen ${days} days ago`;
}
