import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { UpdatesService } from "../../src/updates/updates.service";
import { TasksService } from "../../src/tasks/tasks.service";
import { FilesService } from "../../src/files/files.service";
import { CommentsService } from "../../src/comments/comments.service";
import { DocumentsService } from "../../src/documents/documents.service";
import { InternalItemsService } from "../../src/projects/internal-items.service";
import { WeeklyUpdatesService } from "../../src/updates/weekly-updates.service";
import { DocumentReminderTask } from "../../src/documents/document-reminder.task";
import { PursuitStagesService } from "../../src/projects/pursuit-stages.service";
import { ProjectsService } from "../../src/projects/projects.service";

let prisma: PrismaService;
let updates: UpdatesService;
let tasks: TasksService;
let files: FilesService;
let comments: CommentsService;
let documents: DocumentsService;
let internal: InternalItemsService;
const orgIds: string[] = [];
const userIds: string[] = [];

const notifications = { notifyComment: () => Promise.resolve() };
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const storage = { download: () => Promise.resolve({ body: null, contentType: "text/plain" }) };

beforeAll(async () => {
  assertDisposableDatabase();
  prisma = new PrismaService();
  await prisma.$connect();
  updates = new UpdatesService(prisma, notifications as never, {} as never, storage as never);
  tasks = new TasksService(prisma, notifications as never, {} as never, logger as never);
  files = new FilesService(prisma, {} as never, {} as never, storage as never);
  comments = new CommentsService(prisma, notifications as never);
  documents = new DocumentsService(prisma, storage as never, logger as never, notifications as never, {} as never, {} as never, {} as never);
  internal = new InternalItemsService(prisma);
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch((e: unknown) => console.error(e));
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch((e: unknown) => console.error(e));
  await prisma?.$disconnect();
});

interface Seed {
  orgId: string;
  ownerId: string;
  clientId: string;
  projectId: string;
  internalUpdateId: string;
  internalFileId: string;
  internalTaskId: string;
  internalDocId: string;
  draftDocId: string;
  visibleUpdateId: string;
}

/** A won potential contract with a client, items from before the win (internal), and one update after. */
async function seed(): Promise<Seed> {
  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgId = (await prisma.organization.create({ data: { id: `ii-org-${s}`, name: `ii-${s}`, slug: `ii-${s}` } })).id;
  orgIds.push(orgId);
  const ownerId = `ii-owner-${s}`;
  const clientId = `ii-client-${s}`;
  userIds.push(ownerId, clientId);
  await prisma.user.create({ data: { id: ownerId, name: "Owen", email: `owen-${s}@x.com`, emailVerified: true } });
  await prisma.user.create({ data: { id: clientId, name: "Cleo", email: `cleo-${s}@x.com`, emailVerified: true } });
  await prisma.member.create({ data: { id: `ii-mo-${s}`, organizationId: orgId, userId: ownerId, role: "owner" } });
  await prisma.member.create({ data: { id: `ii-mc-${s}`, organizationId: orgId, userId: clientId, role: "member" } });
  const projectId = (
    await prisma.project.create({
      data: {
        name: "Won bid",
        organizationId: orgId,
        pursuit: { create: { organizationId: orgId, outcome: "won", wonAt: new Date() } },
        clients: { create: { userId: clientId } },
      },
    })
  ).id;
  const base = { projectId, organizationId: orgId };
  const fileOf = (name: string) =>
    prisma.file.create({ data: { ...base, filename: name, uploadedById: ownerId, storageKey: `k/${name}`, internal: true } });

  const attached = await fileOf("pricing.xlsx");
  const internalUpdateId = (
    await prisma.projectUpdate.create({
      data: { ...base, content: "Our margin is thin", authorId: ownerId, fileId: attached.id, internal: true },
    })
  ).id;
  const internalTaskId = (await prisma.task.create({ data: { ...base, title: "Write bid", internal: true } })).id;
  const docFile = await fileOf("proposal.pdf");
  const internalDocId = (
    await prisma.document.create({
      data: { ...base, type: "proposal", title: "Proposal", fileId: docFile.id, uploadedById: ownerId, status: "pending", internal: true },
    })
  ).id;
  const draftFile = await fileOf("draft.pdf");
  const draftDocId = (
    await prisma.document.create({
      data: { ...base, type: "proposal", title: "Draft", fileId: draftFile.id, uploadedById: ownerId, internal: true },
    })
  ).id;
  await prisma.activityLog.create({
    data: { ...base, type: "decision_vote", action: "voted", actorId: ownerId, targetId: internalTaskId, targetTitle: "Write bid", internal: true },
  });
  const visibleUpdateId = (
    await prisma.projectUpdate.create({ data: { ...base, content: "Kickoff Monday", authorId: ownerId } })
  ).id;
  return {
    orgId, ownerId, clientId, projectId, internalUpdateId, internalFileId: attached.id, internalTaskId,
    internalDocId, draftDocId, visibleUpdateId,
  };
}

const ids = (rows: { id: string }[]): string[] => rows.map((r) => r.id);

describe("items from before the win stay internal", () => {
  it("client update timeline omits internal updates and activity", async () => {
    const d = await seed();
    const res = await updates.findTimelineForClient(d.projectId, d.clientId, d.orgId);
    const itemIds: string[] = ids(res.data as { id: string }[]);
    expect(itemIds).toContain(d.visibleUpdateId);
    expect(itemIds).not.toContain(d.internalUpdateId);
    expect(res.data.some((i: { type?: string }) => i.type === "decision_vote")).toBe(false);
  });

  it("client task list omits internal tasks", async () => {
    const d = await seed();
    const res = await tasks.findByProjectForClient(d.projectId, d.clientId, d.orgId);
    expect(ids(res.data)).not.toContain(d.internalTaskId);
  });

  it("staff task list omits internal tasks", async () => {
    const d = await seed();
    const res = await tasks.findByProject(d.projectId, d.orgId);
    expect(ids(res.data)).not.toContain(d.internalTaskId);
  });

  it("client document list omits internal documents", async () => {
    const d = await seed();
    const res = await documents.findByProjectForClient(d.projectId, d.clientId, d.orgId);
    expect(ids(res.data)).not.toContain(d.internalDocId);
  });

  it("client cannot download the file attached to an internal update", async () => {
    const d = await seed();
    await expect(files.download(d.internalFileId, d.orgId, d.clientId, "member")).rejects.toThrow(NotFoundException);
    const listed = await files.findByProject(d.projectId, d.orgId, d.clientId, "member");
    expect(ids(listed.data)).not.toContain(d.internalFileId);
  });

  it("client cannot view an internal document", async () => {
    const d = await seed();
    await expect(documents.getViewStream(d.internalDocId, d.clientId, d.orgId, "member")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("client cannot list or add comments on an internal update", async () => {
    const d = await seed();
    await expect(comments.findByTarget("update", d.internalUpdateId, d.orgId, d.clientId, "member")).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      comments.create("update", d.internalUpdateId, "hi", d.orgId, d.clientId, "member"),
    ).rejects.toThrow(NotFoundException);
  });

  it("internal list returns the internal items, with the attached file under its update", async () => {
    const d = await seed();
    const res = await internal.list(d.projectId, d.orgId);
    expect(ids(res.updates)).toEqual([d.internalUpdateId]);
    expect(ids(res.tasks)).toEqual([d.internalTaskId]);
    expect(ids(res.documents).sort()).toEqual([d.internalDocId, d.draftDocId].sort());
    expect(ids(res.files)).not.toContain(d.internalFileId);
  });

  it("share makes an update and its file visible to the client", async () => {
    const d = await seed();
    await internal.share(d.projectId, "update", d.internalUpdateId, d.orgId);
    const res = await updates.findTimelineForClient(d.projectId, d.clientId, d.orgId);
    expect(ids(res.data as { id: string }[])).toContain(d.internalUpdateId);
    await files.download(d.internalFileId, d.orgId, d.clientId, "member");
  });

  it("sharing an update keeps the staff comments from before the win hidden", async () => {
    const d = await seed();
    await prisma.comment.create({
      data: { content: "Don't drop below 40k", authorId: d.ownerId, organizationId: d.orgId, updateId: d.internalUpdateId, internal: true },
    });
    await internal.share(d.projectId, "update", d.internalUpdateId, d.orgId);
    const res = await comments.findByTarget("update", d.internalUpdateId, d.orgId, d.clientId, "member");
    expect(res.data).toHaveLength(0);
    const timeline = await updates.findTimelineForClient(d.projectId, d.clientId, d.orgId);
    const shared = (timeline.data as { id: string; commentCount?: number }[]).find((i) => i.id === d.internalUpdateId);
    expect(shared?.commentCount).toBe(0);
    const staff = await comments.findByTarget("update", d.internalUpdateId, d.orgId, d.ownerId, "owner");
    expect(staff.data).toHaveLength(1);
  });

  it("sharing a draft document does not show it to the client", async () => {
    const d = await seed();
    await internal.share(d.projectId, "document", d.draftDocId, d.orgId);
    const res = await documents.findByProjectForClient(d.projectId, d.clientId, d.orgId);
    expect(ids(res.data)).not.toContain(d.draftDocId);
  });

  it("share rejects an item from another project", async () => {
    const d = await seed();
    const other = await seed();
    await expect(internal.share(d.projectId, "task", other.internalTaskId, d.orgId)).rejects.toThrow(NotFoundException);
  });

  it("weekly draft leaves out internal tasks and files", async () => {
    const d = await seed();
    await prisma.task.update({ where: { id: d.internalTaskId }, data: { status: "open" } });
    const draft = await new WeeklyUpdatesService(prisma).getDraft(d.projectId, d.orgId);
    expect(draft.content).not.toContain("Write bid");
    expect(draft.content).not.toContain("pricing.xlsx");
    expect(draft.stats.newFiles).toBe(0);
  });

  it("reminder job skips internal documents", async () => {
    const d = await seed();
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await prisma.document.update({
      where: { id: d.internalDocId },
      data: { reminderEnabled: true, sentAt: past, reminderIntervalDays: 1 },
    });
    const reminded: string[] = [];
    const task = new DocumentReminderTask(
      prisma,
      { notifyDocumentReminder: (id: string) => reminded.push(id) } as never,
      { log: () => {} } as never,
    );
    await task.sendReminders();
    expect(reminded).not.toContain(d.internalDocId);
  });

  it("portal project card does not count internal documents as waiting for review", async () => {
    const d = await seed();
    await prisma.document.update({ where: { id: d.internalDocId }, data: { requiresApproval: true } });
    const projects = new ProjectsService(prisma, { linkProjectClients: async () => {} } as never, new PursuitStagesService(prisma));
    const res = await projects.findByClient(d.clientId, d.orgId, {});
    const card = res.data.find((p: { id: string }) => p.id === d.projectId) as { pendingApprovals: number };
    expect(card.pendingApprovals).toBe(0);
  });

  it("duplicating a won project leaves its internal tasks behind", async () => {
    const d = await seed();
    const visibleTaskId = (
      await prisma.task.create({ data: { projectId: d.projectId, organizationId: d.orgId, title: "Kickoff call" } })
    ).id;
    const projects = new ProjectsService(prisma, { linkProjectClients: async () => {} } as never, new PursuitStagesService(prisma));
    const copy = await projects.duplicate(d.projectId, { name: "Copy", includeTasks: true }, d.orgId);
    const titles: string[] = (await prisma.task.findMany({ where: { projectId: copy!.id } })).map((t) => t.title);
    expect(titles).toEqual(["Kickoff call"]);
    expect(visibleTaskId).toBeTruthy();
  });
});
