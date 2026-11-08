import { describe, expect, it, mock } from "bun:test";
import { DashboardLayoutService } from "./dashboard-layout.service";

function build(hidden: string[] = []) {
  const prisma = {
    member: {
      findUniqueOrThrow: mock(() => Promise.resolve({ dashboardHidden: hidden })),
      update: mock(({ data }: { data: { dashboardHidden: string[] } }) => Promise.resolve(data)),
    },
  };
  return { service: new DashboardLayoutService(prisma as never), prisma };
}

describe("DashboardLayoutService", () => {
  it("returns the member's hidden cards", async () => {
    const { service, prisma } = build(["pipeline"]);
    expect(await service.get("m1")).toEqual({ hidden: ["pipeline"] });
    expect(prisma.member.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "m1" },
      select: { dashboardHidden: true },
    });
  });

  it("drops card names that no longer exist when reading", async () => {
    const { service } = build(["pipeline", "oldCard"]);
    expect(await service.get("m1")).toEqual({ hidden: ["pipeline"] });
  });

  it("saves the hidden cards without duplicates", async () => {
    const { service, prisma } = build();
    expect(await service.update("m1", ["activity", "activity", "stats"])).toEqual({ hidden: ["activity", "stats"] });
    expect(prisma.member.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { dashboardHidden: ["activity", "stats"] },
      select: { dashboardHidden: true },
    });
  });
});
