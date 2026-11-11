import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { DEFAULT_STATUSES, MAX_PROJECT_STATUSES } from "@atrium/shared";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ProjectStatusesService } from "../../src/projects/project-statuses.service";
import { ProjectsService } from "../../src/projects/projects.service";

let prisma: PrismaService;
let statuses: ProjectStatusesService;
let projects: ProjectsService;
const orgIds: string[] = [];

beforeAll(async () => {
  assertDisposableDatabase();
  prisma = new PrismaService();
  await prisma.$connect();
  statuses = new ProjectStatusesService(prisma);
  projects = new ProjectsService(prisma, {} as never, {} as never);
});

afterAll(async () => {
  await prisma.projectStatus.deleteMany({ where: { organizationId: { in: orgIds } } }).catch((e: unknown) => console.error(e));
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch((e: unknown) => console.error(e));
  await prisma?.$disconnect();
});

async function org(): Promise<string> {
  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const id = (await prisma.organization.create({ data: { id: `st-org-${s}`, name: `st-${s}`, slug: `st-${s}` } })).id;
  orgIds.push(id);
  await prisma.projectStatus.createMany({ data: DEFAULT_STATUSES.map((d) => ({ ...d, organizationId: id })) });
  return id;
}

describe("ProjectStatusesService against Postgres", () => {
  it("concurrent creates never pass the cap or add names that differ only by case", async () => {
    const orgId = await org();
    const names: string[] = Array.from({ length: 12 }, (_, i) => (i % 2 ? `Step ${i >> 1}` : `STEP ${i >> 1}`));
    await Promise.allSettled(names.map((name) => statuses.create({ name }, orgId)));

    const rows = await prisma.projectStatus.findMany({ where: { organizationId: orgId } });
    expect(rows.length).toBeLessThanOrEqual(MAX_PROJECT_STATUSES);
    expect(new Set(rows.map((r) => r.name.toLowerCase())).size).toBe(rows.length);
  });

  it("a project status change racing a delete never leaves a deleted slug behind", async () => {
    const orgId = await org();
    const design = await statuses.create({ name: "Design" }, orgId);
    const inProgress = (await prisma.projectStatus.findFirstOrThrow({ where: { organizationId: orgId, slug: "in_progress" } })).id;
    const project = await prisma.project.create({ data: { name: "p", organizationId: orgId } });

    await Promise.allSettled([
      projects.update(project.id, { status: "design" }, orgId),
      statuses.remove(design.id, inProgress, orgId),
    ]);

    const { status } = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(await prisma.projectStatus.count({ where: { organizationId: orgId, slug: status } })).toBe(1);
  });
});
