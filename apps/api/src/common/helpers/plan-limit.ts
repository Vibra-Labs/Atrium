import type { PlanLimitResource } from "../decorators/plan-limit.decorator";

export interface PlanLimits {
  name: string;
  maxProjects: number;
  maxStorageMb: number;
  maxMembers: number;
  maxClients: number;
}

export interface PlanUsage {
  projects: number;
  storageMb: number;
  members: number;
  clients: number;
}

/** Returns the upgrade message when the org is at its limit, or null. -1 means unlimited. */
export function planLimitMessage(
  plan: PlanLimits,
  usage: PlanUsage,
  resource: PlanLimitResource,
): string | null {
  const table: Record<PlanLimitResource, { limit: number; current: number; label: string }> = {
    projects: { limit: plan.maxProjects, current: usage.projects, label: "projects" },
    storage: { limit: plan.maxStorageMb, current: usage.storageMb, label: "storage (MB)" },
    members: { limit: plan.maxMembers, current: usage.members, label: "team members" },
    clients: { limit: plan.maxClients, current: usage.clients, label: "clients" },
  };
  const { limit, current, label } = table[resource];
  if (limit === -1 || current < limit) return null;
  return `You've reached the ${label} limit (${current}/${limit}) on your ${plan.name} plan. Please upgrade to continue.`;
}
