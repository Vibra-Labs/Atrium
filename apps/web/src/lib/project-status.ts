// A workspace's project statuses (the chips on a signed project), as set in Settings → Workspace.

import { BUILT_IN_STATUS_SLUGS } from "@atrium/shared";
import { useCachedApi } from "@/lib/cached";

export interface ProjectStatus {
  id: string;
  name: string;
  slug: string;
  order: number;
  color: string;
}

export const PROJECT_STATUSES_PATH = "/projects/statuses";

/** The workspace's statuses in order, cached; null while loading. Call invalidate(PROJECT_STATUSES_PATH) after a change. */
export function useProjectStatuses(): ProjectStatus[] | null {
  return useCachedApi<ProjectStatus[]>(PROJECT_STATUSES_PATH);
}

/** The workspace's name for a status; a readable slug while loading or when unknown. */
export function statusLabel(statuses: ProjectStatus[] | null, slug: string): string {
  return statuses?.find((s) => s.slug === slug)?.name ?? slug.replace(/_/g, " ");
}

export function statusColor(statuses: ProjectStatus[] | null, slug: string): string {
  return statuses?.find((s) => s.slug === slug)?.color ?? "#6b7280";
}

/** Built-in statuses can be renamed and recolored but not deleted. */
export function isBuiltInStatus(slug: string): boolean {
  return BUILT_IN_STATUS_SLUGS.includes(slug);
}
