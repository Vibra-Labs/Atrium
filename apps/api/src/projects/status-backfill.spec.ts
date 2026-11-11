import { describe, expect, it, mock } from "bun:test";
import { DEFAULT_STATUSES, MAX_PROJECT_STATUSES } from "@atrium/shared";
import { ProjectsService } from "./projects.service";
import type { PrismaService } from "../prisma/prisma.service";

interface Row {
  organizationId: string;
  name: string;
  slug: string;
  order: number;
}

interface CreateManyArgs {
  data: Row[];
  skipDuplicates: boolean;
}

function build(orgIds: string[], existing: Row[] = []) {
  const prisma = {
    organization: {
      findMany: mock(() => Promise.resolve(orgIds.map((id) => ({ id })))),
    },
    projectStatus: {
      findMany: mock(() => Promise.resolve(existing)),
      createMany: mock((_args: CreateManyArgs) => Promise.resolve({ count: 0 })),
    },
  };
  const service = new ProjectsService(prisma as unknown as PrismaService, {} as never, {} as never);
  return { service, prisma };
}

const row = (organizationId: string, slug: string, order: number): Row => ({ organizationId, name: slug, slug, order });

describe("default status backfill", () => {
  it("includes a Cancelled status in the defaults", () => {
    expect(DEFAULT_STATUSES.map((s) => s.slug)).toContain("cancelled");
  });

  it("adds every default status to a workspace that has none", async () => {
    const { service, prisma } = build(["org1", "org2"]);
    await service.backfillDefaultStatuses();

    const args = prisma.projectStatus.createMany.mock.calls[0][0];
    expect(args.skipDuplicates).toBe(true);
    expect(args.data).toHaveLength(DEFAULT_STATUSES.length * 2);
    expect(args.data).toContainEqual(expect.objectContaining({ organizationId: "org2", slug: "cancelled", order: 4 }));
  });

  it("adds only missing defaults, after the workspace's own last status", async () => {
    const existing: Row[] = DEFAULT_STATUSES.filter((d) => d.slug !== "cancelled").map((d, i) => row("org1", d.slug, i * 2));
    existing.push(row("org1", "design", 20));
    const { service, prisma } = build(["org1"], existing);
    await service.backfillDefaultStatuses();

    expect(prisma.projectStatus.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ organizationId: "org1", slug: "cancelled", order: 21 }),
    ]);
  });

  it("never takes a workspace past the status cap", async () => {
    const existing: Row[] = Array.from({ length: MAX_PROJECT_STATUSES }, (_, i) => row("org1", `s${i}`, i));
    const { service, prisma } = build(["org1"], existing);
    await service.backfillDefaultStatuses();
    expect(prisma.projectStatus.createMany).not.toHaveBeenCalled();
  });

  it("does nothing when there are no workspaces", async () => {
    const { service, prisma } = build([]);
    await service.backfillDefaultStatuses();
    expect(prisma.projectStatus.createMany).not.toHaveBeenCalled();
  });
});
