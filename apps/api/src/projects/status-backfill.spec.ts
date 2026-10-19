import { describe, expect, it, mock } from "bun:test";
import { DEFAULT_STATUSES } from "@atrium/shared";
import { ProjectsService } from "./projects.service";
import type { PrismaService } from "../prisma/prisma.service";

interface CreateManyArgs {
  data: { organizationId: string; slug: string }[];
  skipDuplicates: boolean;
}

function build(orgIds: string[]) {
  const prisma = {
    organization: {
      findMany: mock(() => Promise.resolve(orgIds.map((id) => ({ id })))),
    },
    projectStatus: {
      createMany: mock((_args: CreateManyArgs) => Promise.resolve({ count: 0 })),
    },
  };
  const service = new ProjectsService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe("default status backfill", () => {
  it("includes a Cancelled status in the defaults", () => {
    expect(DEFAULT_STATUSES.map((s) => s.slug)).toContain("cancelled");
  });

  it("adds every default status to every workspace, skipping existing ones", async () => {
    const { service, prisma } = build(["org1", "org2"]);
    await service.backfillDefaultStatuses();

    const args = prisma.projectStatus.createMany.mock.calls[0][0];
    expect(args.skipDuplicates).toBe(true);
    expect(args.data).toHaveLength(DEFAULT_STATUSES.length * 2);
    expect(args.data).toContainEqual(
      expect.objectContaining({ organizationId: "org2", slug: "cancelled" }),
    );
  });

  it("does nothing when there are no workspaces", async () => {
    const { service, prisma } = build([]);
    await service.backfillDefaultStatuses();
    expect(prisma.projectStatus.createMany).not.toHaveBeenCalled();
  });
});
