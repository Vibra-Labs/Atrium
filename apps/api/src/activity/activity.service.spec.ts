import { describe, expect, it, mock } from "bun:test";
import { ActivityService } from "./activity.service";

function buildPrisma(logs: { id: string; actorId: string }[], users: { id: string; name: string }[]) {
  return {
    activityLog: { findMany: mock(() => Promise.resolve(logs)) },
    user: { findMany: mock(() => Promise.resolve(users)) },
  };
}

describe("ActivityService.findByOrg", () => {
  it("returns the newest activity in the workspace with actor names", async () => {
    const prisma = buildPrisma([{ id: "a1", actorId: "u1" }], [{ id: "u1", name: "Ana" }]);
    const service = new ActivityService(prisma as never);

    const result = await service.findByOrg("org-1", 5);

    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1" }, orderBy: { createdAt: "desc" }, take: 5 }),
    );
    expect(result[0].actor).toEqual({ id: "u1", name: "Ana" });
  });

  it("labels an actor whose account is gone the same way as the project feed", async () => {
    const prisma = buildPrisma([{ id: "a1", actorId: "gone" }], []);
    const service = new ActivityService(prisma as never);

    const result = await service.findByOrg("org-1");

    expect(result[0].actor).toEqual({ id: "gone", name: "Unknown" });
  });
});
