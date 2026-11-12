import type { PrismaService } from "../prisma/prisma.service";

export interface WorkspaceActivity {
  /** Projects with at least one client on them. */
  sharedProjects: number;
  /** Portal clients who have joined. */
  clients: number;
  updates: number;
}

/** What a workspace has done so far, for the usage card and the trial emails. */
export async function workspaceActivity(prisma: PrismaService, orgId: string): Promise<WorkspaceActivity> {
  const [sharedProjects, clients, updates] = await Promise.all([
    prisma.project.count({ where: { organizationId: orgId, clients: { some: {} } } }),
    prisma.member.count({ where: { organizationId: orgId, role: "member" } }),
    prisma.projectUpdate.count({ where: { organizationId: orgId } }),
  ]);
  return { sharedProjects, clients, updates };
}
