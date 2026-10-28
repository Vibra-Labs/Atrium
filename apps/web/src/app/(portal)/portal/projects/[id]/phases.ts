import { DEFAULT_STATUSES, PROJECT_STATUSES } from "@atrium/shared";

interface StatusLike {
  slug: string;
  name: string;
  order: number;
}

export interface Phase {
  key: string;
  label: string;
}

/**
 * The milestone track on the portal project page: every workspace status in
 * order, minus "cancelled". currentIndex is -1 when the project's status isn't
 * on the track, so nothing is shown as done or current.
 */
export function projectPhases(
  statuses: StatusLike[],
  currentSlug: string | undefined,
): { phases: Phase[]; currentIndex: number } {
  const source = statuses.length > 0 ? statuses : DEFAULT_STATUSES;
  const phases: Phase[] = source
    .filter((st) => st.slug !== PROJECT_STATUSES.CANCELLED)
    .sort((a, b) => a.order - b.order)
    .map((st) => ({ key: st.slug, label: st.name }));
  return { phases, currentIndex: phases.findIndex((p) => p.key === currentSlug) };
}
