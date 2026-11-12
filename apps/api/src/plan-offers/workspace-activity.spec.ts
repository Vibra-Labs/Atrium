import { describe, expect, it, mock } from "bun:test";
import { workspaceActivity } from "./workspace-activity";
import type { PrismaService } from "../prisma/prisma.service";

describe("workspaceActivity", () => {
  it("counts shared projects, clients and updates for the workspace", async () => {
    const prisma = {
      project: { count: mock(() => Promise.resolve(2)) },
      member: { count: mock(() => Promise.resolve(5)) },
      projectUpdate: { count: mock(() => Promise.resolve(7)) },
    };
    const result = await workspaceActivity(prisma as unknown as PrismaService, "org-1");
    expect(result).toEqual({ sharedProjects: 2, clients: 5, updates: 7 });
    expect(prisma.project.count).toHaveBeenCalledWith({ where: { organizationId: "org-1", clients: { some: {} } } });
    expect(prisma.member.count).toHaveBeenCalledWith({ where: { organizationId: "org-1", role: "member" } });
    expect(prisma.projectUpdate.count).toHaveBeenCalledWith({ where: { organizationId: "org-1" } });
  });
});
