import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "./projects.service";

let service: ProjectsService;
let prisma: PrismaService;
let orgIds: string[] = [];
let userIds: string[] = [];
let slug = "";
let memberUserId = "";
let nonMemberUserId = "";

function assertTestDatabase() {
  const databaseUrl = process.env.DATABASE_URL || "";
  const testDatabaseUrl = process.env.TEST_DATABASE_URL || "";
  const testBranchName = process.env.TEST_DATABASE_BRANCH_NAME || "";

  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is not set; refusing to run status-page service spec");
  }
  if (databaseUrl !== testDatabaseUrl) {
    throw new Error("DATABASE_URL is not TEST_DATABASE_URL; refusing to run status-page service spec");
  }
  if (testBranchName && testBranchName !== "test") {
    throw new Error(`TEST_DATABASE_BRANCH_NAME is '${testBranchName}', expected 'test'`);
  }
}

async function cleanup() {
  if (orgIds.length) {
    await prisma.comment.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.taskDeliverable.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.projectUpdate.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.task.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.file.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.member.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  }
  if (userIds.length) {
    await prisma.projectClient.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  orgIds = [];
  userIds = [];
}

beforeAll(async () => {
  assertTestDatabase();
  const mod = await Test.createTestingModule({
    providers: [ProjectsService, PrismaService],
  }).compile();
  service = mod.get(ProjectsService);
  prisma = mod.get(PrismaService);
});

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  slug = `status-spec-${stamp}`;
  const orgId = `status-org-${stamp}`;
  const otherOrgId = `status-other-org-${stamp}`;
  memberUserId = `status-member-${stamp}`;
  nonMemberUserId = `status-non-member-${stamp}`;
  const clientUserId = `status-client-${stamp}`;
  const authorId = `status-author-${stamp}`;
  orgIds = [orgId, otherOrgId];
  userIds = [memberUserId, nonMemberUserId, clientUserId, authorId];

  await prisma.organization.createMany({
    data: [
      { id: orgId, name: "Status Org", slug: `status-org-${stamp}` },
      { id: otherOrgId, name: "Other Org", slug: `status-other-org-${stamp}` },
    ],
  });
  await prisma.user.createMany({
    data: [
      { id: memberUserId, name: "Member", email: `member-${stamp}@example.com`, emailVerified: true },
      { id: nonMemberUserId, name: "Non Member", email: `non-member-${stamp}@example.com`, emailVerified: true },
      { id: clientUserId, name: "Client", email: `client-${stamp}@example.com`, emailVerified: true },
      { id: authorId, name: "Author", email: `author-${stamp}@example.com`, emailVerified: true },
    ],
  });
  await prisma.member.createMany({
    data: [
      { id: `status-member-row-${stamp}`, organizationId: orgId, userId: memberUserId, role: "member" },
      { id: `status-other-member-row-${stamp}`, organizationId: otherOrgId, userId: nonMemberUserId, role: "member" },
    ],
  });

  const project = await prisma.project.create({
    data: {
      name: "Status Project",
      description: "Client-visible project status",
      slug,
      status: "in_progress",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      completedAt: null,
      organizationId: orgId,
    },
  });
  await prisma.projectClient.create({ data: { projectId: project.id, userId: clientUserId } });

  await prisma.projectUpdate.createMany({
    data: [
      {
        id: `status-visible-update-old-${stamp}`,
        projectId: project.id,
        organizationId: orgId,
        authorId,
        title: "Old visible update",
        content: "Visible old",
        clientVisible: true,
        createdAt: new Date("2026-05-02T00:00:00.000Z"),
      },
      {
        id: `status-hidden-update-${stamp}`,
        projectId: project.id,
        organizationId: orgId,
        authorId,
        title: "Hidden update",
        content: "Hidden",
        clientVisible: false,
        createdAt: new Date("2026-05-03T00:00:00.000Z"),
      },
      {
        id: `status-visible-update-new-${stamp}`,
        projectId: project.id,
        organizationId: orgId,
        authorId,
        title: "New visible update",
        content: "Visible new",
        clientVisible: true,
        createdAt: new Date("2026-05-04T00:00:00.000Z"),
      },
    ],
  });

  await prisma.comment.createMany({
    data: [
      {
        id: `status-visible-project-comment-${stamp}`,
        projectId: project.id,
        organizationId: orgId,
        authorId,
        content: "Visible project comment",
        clientVisible: true,
        createdAt: new Date("2026-05-02T00:00:00.000Z"),
      },
      {
        id: `status-hidden-project-comment-${stamp}`,
        projectId: project.id,
        organizationId: orgId,
        authorId,
        content: "Hidden project comment",
        clientVisible: false,
        createdAt: new Date("2026-05-03T00:00:00.000Z"),
      },
    ],
  });

  const firstTask = await prisma.task.create({
    data: {
      id: `status-task-first-${stamp}`,
      projectId: project.id,
      organizationId: orgId,
      title: "First visible task",
      description: "First",
      status: "open",
      order: 1,
      clientVisible: true,
      createdAt: new Date("2026-05-04T00:00:00.000Z"),
    },
  });
  await prisma.task.create({
    data: {
      id: `status-task-hidden-${stamp}`,
      projectId: project.id,
      organizationId: orgId,
      title: "Hidden task",
      status: "open",
      order: 0,
      clientVisible: false,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    },
  });
  await prisma.task.create({
    data: {
      id: `status-task-second-${stamp}`,
      projectId: project.id,
      organizationId: orgId,
      title: "Second visible task",
      status: "done",
      completedAt: new Date("2026-05-05T00:00:00.000Z"),
      order: 2,
      clientVisible: true,
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
    },
  });

  await prisma.comment.createMany({
    data: [
      {
        id: `status-visible-task-comment-${stamp}`,
        taskId: firstTask.id,
        organizationId: orgId,
        authorId,
        content: "Visible task comment",
        clientVisible: true,
        createdAt: new Date("2026-05-02T00:00:00.000Z"),
      },
      {
        id: `status-hidden-task-comment-${stamp}`,
        taskId: firstTask.id,
        organizationId: orgId,
        authorId,
        content: "Hidden task comment",
        clientVisible: false,
        createdAt: new Date("2026-05-03T00:00:00.000Z"),
      },
    ],
  });

  const file = await prisma.file.create({
    data: {
      filename: "visible.pdf",
      url: "https://example.com/visible.pdf",
      organizationId: orgId,
      uploadedById: authorId,
      projectId: project.id,
    },
  });
  await prisma.taskDeliverable.createMany({
    data: [
      {
        id: `status-visible-deliverable-${stamp}`,
        taskId: firstTask.id,
        organizationId: orgId,
        title: "Visible deliverable",
        type: "file",
        fileId: file.id,
        clientVisible: true,
        createdAt: new Date("2026-05-02T00:00:00.000Z"),
      },
      {
        id: `status-hidden-deliverable-${stamp}`,
        taskId: firstTask.id,
        organizationId: orgId,
        title: "Hidden deliverable",
        type: "link",
        url: "https://example.com/hidden",
        clientVisible: false,
        createdAt: new Date("2026-05-03T00:00:00.000Z"),
      },
    ],
  });
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ProjectsService.findStatusPageProjectBySlug", () => {
  it("returns the full status page graph for a member-visible project", async () => {
    const result = await service.findStatusPageProjectBySlug(slug, memberUserId);

    expect(result.name).toBe("Status Project");
    expect(result.description).toBe("Client-visible project status");
    expect(result.status).toBe("in_progress");
    expect(result.organization.name).toBe("Status Org");
    expect(result.clients).toHaveLength(1);
    expect(result.clients[0].user.email).toContain("client-");
    expect(result.updates.map((update) => update.title)).toEqual(["New visible update", "Old visible update"]);
    expect(result.comments.map((comment) => comment.content)).toEqual(["Visible project comment"]);
    expect(result.tasks.map((task) => task.title)).toEqual(["First visible task", "Second visible task"]);
    expect(result.tasks[0].comments.map((comment) => comment.content)).toEqual(["Visible task comment"]);
    expect(result.tasks[0].deliverables).toEqual([
      {
        id: expect.stringContaining("status-visible-deliverable-"),
        title: "Visible deliverable",
        type: "file",
        url: null,
        file: { filename: "visible.pdf", url: "https://example.com/visible.pdf" },
      },
    ]);
  });

  it("denies an existing slug to a user outside the project organization", async () => {
    await expect(service.findStatusPageProjectBySlug(slug, nonMemberUserId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("returns not found when no project exists for the slug", async () => {
    await expect(service.findStatusPageProjectBySlug(`missing-${slug}`, memberUserId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("excludes hidden updates, comments, tasks, and deliverables", async () => {
    const result = await service.findStatusPageProjectBySlug(slug, memberUserId);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("Hidden update");
    expect(serialized).not.toContain("Hidden project comment");
    expect(serialized).not.toContain("Hidden task");
    expect(serialized).not.toContain("Hidden task comment");
    expect(serialized).not.toContain("Hidden deliverable");
  });
});
