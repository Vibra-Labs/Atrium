import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Test } from "@nestjs/testing";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ProjectsService } from "../../src/projects/projects.service";
import { ContactSyncService } from "../../src/contact-sync/contact-sync.service";

let service: ProjectsService;
let prisma: PrismaService;
let orgId: string;
let sourceId: string;
const labelIds: string[] = [];

beforeAll(async () => {
  assertDisposableDatabase();
  const mod = await Test.createTestingModule({
    providers: [
      ProjectsService,
      PrismaService,
      { provide: ContactSyncService, useValue: { linkProjectClients: async (): Promise<void> => undefined } },
    ],
  }).compile();
  service = mod.get(ProjectsService);
  prisma = mod.get(PrismaService);
  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  orgId = (await prisma.organization.create({ data: { id: `pd-org-${s}`, name: `pd-${s}`, slug: `pd-${s}` } })).id;
  for (const name of ["l1", "l2", "l3"]) {
    labelIds.push((await prisma.label.create({ data: { name, organizationId: orgId } })).id);
  }
  const user = await prisma.user.create({ data: { id: `pd-u-${s}`, name: "U", email: `pd-${s}@x.com`, emailVerified: true } });
  sourceId = (await prisma.project.create({ data: { name: "Template", organizationId: orgId } })).id;
  await prisma.projectLabel.create({ data: { projectId: sourceId, labelId: labelIds[0] } });
  for (let i = 0; i < 50; i++) {
    const decision = i % 5 === 0;
    const task = await prisma.task.create({
      data: {
        title: `task ${i}`,
        description: i % 2 ? `desc ${i}` : null,
        order: 49 - i,
        type: decision ? "decision" : "checkbox",
        question: decision ? `q${i}?` : null,
        status: "done",
        dueDate: new Date("2026-05-01"),
        assigneeId: user.id,
        requestedById: user.id,
        closedAt: new Date(),
        projectId: sourceId,
        organizationId: orgId,
      },
    });
    if (decision) {
      await prisma.decisionOption.createMany({
        data: [0, 1, 2].map((o) => ({ taskId: task.id, label: `opt ${i}-${o}`, order: o })),
      });
    }
    if (i % 3 === 0) {
      await prisma.taskLabel.createMany({
        data: [labelIds[0], labelIds[1]].map((labelId) => ({ taskId: task.id, labelId })),
      });
    }
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("ProjectsService.duplicate", () => {
  it("copies 50 tasks with options and labels, resetting state", async () => {
    const copy = await service.duplicate(sourceId, { name: "Copy" }, orgId);
    expect(copy).not.toBeNull();
    const tasks = await prisma.task.findMany({
      where: { projectId: copy!.id },
      include: { options: true, labels: true },
      orderBy: { order: "asc" },
    });
    expect(tasks.length).toBe(50);
    expect(tasks.map((t) => t.order)).toEqual(Array.from({ length: 50 }, (_, k) => k));
    for (const t of tasks) {
      const i = 49 - t.order;
      expect(t.title).toBe(`task ${i}`);
      expect(t.description).toBe(i % 2 ? `desc ${i}` : null);
      expect(t.type).toBe(i % 5 === 0 ? "decision" : "checkbox");
      expect(t.question).toBe(i % 5 === 0 ? `q${i}?` : null);
      expect(t.status).toBe("open");
      expect(t.dueDate).toBeNull();
      expect(t.closedAt).toBeNull();
      expect(t.assigneeId).toBeNull();
      expect(t.requestedById).toBeNull();
      expect(t.organizationId).toBe(orgId);
      expect(t.options.map((o) => `${o.label}|${o.order}`).sort()).toEqual(
        i % 5 === 0 ? [0, 1, 2].map((o) => `opt ${i}-${o}|${o}`) : [],
      );
      expect(t.labels.map((l) => l.labelId).sort()).toEqual(i % 3 === 0 ? [labelIds[0], labelIds[1]].sort() : []);
    }
    const projectLabels = await prisma.projectLabel.findMany({ where: { projectId: copy!.id } });
    expect(projectLabels.map((l) => l.labelId)).toEqual([labelIds[0]]);
  });

  it("can skip tasks", async () => {
    const copy = await service.duplicate(sourceId, { name: "Empty copy", includeTasks: false }, orgId);
    expect(await prisma.task.count({ where: { projectId: copy!.id } })).toBe(0);
  });
});
