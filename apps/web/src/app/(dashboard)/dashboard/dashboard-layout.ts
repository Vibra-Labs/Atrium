import type { DashboardWidget } from "@atrium/shared";

/** Hides the card if it's showing, shows it if it's hidden. */
export function toggleHidden(hidden: DashboardWidget[], key: DashboardWidget): DashboardWidget[] {
  return hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
}
