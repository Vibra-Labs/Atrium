/** Staff management lives in Settings; /dashboard/team and the old People page redirect here. */
export const TEAM_PATH = "/dashboard/settings/team";

/**
 * Where the old People page (/dashboard/clients) sends you now: its Team tab became
 * Settings → Team; clients are contacts with portal access.
 */
export function clientsRedirectTarget(tab: string | string[] | undefined): string {
  return tab === "team" ? TEAM_PATH : "/dashboard/contacts?access=portal";
}

/** A preview's return path, kept only when it is a dashboard page on this site. */
export function previewReturnPath(value: string | undefined): string | undefined {
  return value && /^\/dashboard\/[^/\\]/.test(value) ? value : undefined;
}
