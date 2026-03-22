import { describe, expect, it, mock, beforeEach } from "bun:test";
import { CommentsService } from "./comments.service";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ORG = "org-1";
const USER = "user-1";
const ADMIN_USER = "admin-1";
const OTHER_USER = "user-2";
const PROJECT_ID = "project-1";
const UPDATE_ID = "update-1";
const TASK_ID = "task-1";
const COMMENT_ID = "comment-1";

function makeComment(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMENT_ID,
    content: "Test comment",
    authorId: USER,
    organizationId: ORG,
    updateId: UPDATE_ID,
    taskId: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeAuthor(overrides: Record<string, unknown> = {}) {
  return { id: USER, name: "Alice Smith", ...overrides };
}

// ---------------------------------------------------------------------------
// Mock Prisma client
// ---------------------------------------------------------------------------

interface PrismaArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
  select?: Record<string, unknown>;
  orderBy?: Record<string, unknown>;
  skip?: number;
  take?: number;
}

const mockPrisma = {
  projectUpdate: {
    findFirst: mock(() => Promise.resolve({ projectId: PROJECT_ID })),
  },
  task: {
    findFirst: mock(() => Promise.resolve({ projectId: PROJECT_ID })),
  },
  projectClient: {
    findFirst: mock(() => Promise.resolve({ projectId: PROJECT_ID, userId: USER })),
  },
  comment: {
    create: mock((args: PrismaArgs) =>
      Promise.resolve({ id: COMMENT_ID, ...args.data }),
    ),
    findMany: mock(() => Promise.resolve([])),
    count: mock(() => Promise.resolve(0)),
    findFirst: mock(() => Promise.resolve(null)),
    delete: mock(() => Promise.resolve({ id: COMMENT_ID })),
  },
  user: {
    findMany: mock(() => Promise.resolve([])),
  },
};

// ---------------------------------------------------------------------------
// Helper: clear all mocks between tests
// ---------------------------------------------------------------------------

function clearAllMocks() {
  mockPrisma.projectUpdate.findFirst.mockClear();
  mockPrisma.task.findFirst.mockClear();
  mockPrisma.projectClient.findFirst.mockClear();
  mockPrisma.comment.create.mockClear();
  mockPrisma.comment.findMany.mockClear();
  mockPrisma.comment.count.mockClear();
  mockPrisma.comment.findFirst.mockClear();
  mockPrisma.comment.delete.mockClear();
  mockPrisma.user.findMany.mockClear();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("CommentsService", () => {
  let service: CommentsService;

  beforeEach(() => {
    clearAllMocks();

    // Restore defaults after each test
    mockPrisma.projectUpdate.findFirst.mockReturnValue(
      Promise.resolve({ projectId: PROJECT_ID }),
    );
    mockPrisma.task.findFirst.mockReturnValue(
      Promise.resolve({ projectId: PROJECT_ID }),
    );
    mockPrisma.projectClient.findFirst.mockReturnValue(
      Promise.resolve({ projectId: PROJECT_ID, userId: USER }),
    );
    mockPrisma.comment.create.mockImplementation((args: PrismaArgs) =>
      Promise.resolve({ id: COMMENT_ID, ...args.data }),
    );
    mockPrisma.comment.findMany.mockReturnValue(Promise.resolve([]));
    mockPrisma.comment.count.mockReturnValue(Promise.resolve(0));
    mockPrisma.comment.findFirst.mockReturnValue(Promise.resolve(null));
    mockPrisma.comment.delete.mockReturnValue(Promise.resolve({ id: COMMENT_ID }));
    mockPrisma.user.findMany.mockReturnValue(Promise.resolve([]));

    service = new CommentsService(mockPrisma as unknown as PrismaService);
  });

  // =========================================================================
  // CommentsService.create
  // =========================================================================

  describe("create", () => {
    describe("success paths", () => {
      it("creates a comment linked to an update when target type is 'update'", async () => {
        const result = await service.create(
          "update",
          UPDATE_ID,
          "Great progress!",
          ORG,
          USER,
          "owner",
        );

        expect(mockPrisma.comment.create).toHaveBeenCalledWith({
          data: {
            content: "Great progress!",
            authorId: USER,
            organizationId: ORG,
            updateId: UPDATE_ID,
          },
        });
        expect(result).toMatchObject({ content: "Great progress!" });
      });

      it("creates a comment linked to a task when target type is 'task'", async () => {
        mockPrisma.task.findFirst.mockReturnValue(
          Promise.resolve({ projectId: PROJECT_ID }),
        );

        await service.create("task", TASK_ID, "On it", ORG, USER, "owner");

        expect(mockPrisma.comment.create).toHaveBeenCalledWith({
          data: {
            content: "On it",
            authorId: USER,
            organizationId: ORG,
            taskId: TASK_ID,
          },
        });
        // updateId must NOT be present when target is task
        const callArgs = (mockPrisma.comment.create as ReturnType<typeof mock>).mock.calls[0][0] as PrismaArgs;
        expect(callArgs.data).not.toHaveProperty("updateId");
      });

      it("does not query projectClient when role is 'owner' (privileged bypass)", async () => {
        await service.create("update", UPDATE_ID, "Note", ORG, USER, "owner");

        expect(mockPrisma.projectClient.findFirst).not.toHaveBeenCalled();
      });

      it("does not query projectClient when role is 'admin' (privileged bypass)", async () => {
        await service.create("update", UPDATE_ID, "Note", ORG, ADMIN_USER, "admin");

        expect(mockPrisma.projectClient.findFirst).not.toHaveBeenCalled();
      });

      it("queries projectClient to verify assignment for 'member' role", async () => {
        await service.create("update", UPDATE_ID, "Comment", ORG, USER, "member");

        expect(mockPrisma.projectClient.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ projectId: PROJECT_ID, userId: USER }),
          }),
        );
      });

      it("stores content exactly as provided (does not transform)", async () => {
        const content = "Hello, <world> & \"everyone\"!";
        await service.create("update", UPDATE_ID, content, ORG, USER, "owner");

        const callArgs = (mockPrisma.comment.create as ReturnType<typeof mock>).mock.calls[0][0] as PrismaArgs;
        expect(callArgs.data?.content).toBe(content);
      });

      it("stores content with the maximum allowed length (2000 chars)", async () => {
        const longContent = "a".repeat(2000);
        await service.create("update", UPDATE_ID, longContent, ORG, USER, "owner");

        const callArgs = (mockPrisma.comment.create as ReturnType<typeof mock>).mock.calls[0][0] as PrismaArgs;
        expect((callArgs.data?.content as string).length).toBe(2000);
      });

      it("stores content with special unicode characters", async () => {
        const unicodeContent = "Comment with emojis 🎉 and symbols ™©®";
        await service.create("update", UPDATE_ID, unicodeContent, ORG, USER, "owner");

        const callArgs = (mockPrisma.comment.create as ReturnType<typeof mock>).mock.calls[0][0] as PrismaArgs;
        expect(callArgs.data?.content).toBe(unicodeContent);
      });
    });

    describe("target not found", () => {
      it("throws NotFoundException when update does not exist", async () => {
        mockPrisma.projectUpdate.findFirst.mockReturnValue(Promise.resolve(null));

        try {
          await service.create("update", "nonexistent-update", "Hello", ORG, USER, "owner");
          expect(true).toBe(false); // must not reach
        } catch (e) {
          expect(e).toBeInstanceOf(NotFoundException);
          expect((e as NotFoundException).message).toBe("Update not found");
        }
      });

      it("throws NotFoundException when task does not exist", async () => {
        mockPrisma.task.findFirst.mockReturnValue(Promise.resolve(null));

        try {
          await service.create("task", "nonexistent-task", "Hello", ORG, USER, "owner");
          expect(true).toBe(false); // must not reach
        } catch (e) {
          expect(e).toBeInstanceOf(NotFoundException);
          expect((e as NotFoundException).message).toBe("Task not found");
        }
      });

      it("scopes update lookup to the correct organization", async () => {
        await service.create("update", UPDATE_ID, "Hi", ORG, USER, "owner");

        expect(mockPrisma.projectUpdate.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: UPDATE_ID,
              organizationId: ORG,
            }),
          }),
        );
      });

      it("scopes task lookup to the correct organization", async () => {
        await service.create("task", TASK_ID, "Hi", ORG, USER, "owner");

        expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: TASK_ID,
              organizationId: ORG,
            }),
          }),
        );
      });
    });

    describe("access control", () => {
      it("throws ForbiddenException when 'member' is not assigned to the project", async () => {
        // member role + no projectClient assignment
        mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));

        try {
          await service.create("update", UPDATE_ID, "Hello", ORG, USER, "member");
          expect(true).toBe(false); // must not reach
        } catch (e) {
          expect(e).toBeInstanceOf(ForbiddenException);
        }
      });

      it("does not create the comment when access is denied", async () => {
        mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));

        try {
          await service.create("update", UPDATE_ID, "Hello", ORG, USER, "member");
        } catch {
          // expected
        }

        expect(mockPrisma.comment.create).not.toHaveBeenCalled();
      });
    });

    describe("whitespace content edge cases", () => {
      it("passes whitespace-only content through to the database (validation is DTO-layer concern)", async () => {
        // The service itself does not trim or validate content; that belongs to the DTO.
        // If whitespace somehow reaches the service, it should be persisted as-is.
        await service.create("update", UPDATE_ID, "   ", ORG, USER, "owner");

        const callArgs = (mockPrisma.comment.create as ReturnType<typeof mock>).mock.calls[0][0] as PrismaArgs;
        expect(callArgs.data?.content).toBe("   ");
      });
    });
  });

  // =========================================================================
  // CommentsService.findByTarget
  // =========================================================================

  describe("findByTarget", () => {
    describe("success paths", () => {
      it("returns an empty paginated response when no comments exist", async () => {
        mockPrisma.comment.findMany.mockReturnValue(Promise.resolve([]));
        mockPrisma.comment.count.mockReturnValue(Promise.resolve(0));

        const result = await service.findByTarget(
          "update",
          UPDATE_ID,
          ORG,
          USER,
          "owner",
          1,
          50,
        );

        expect(result.data).toEqual([]);
        expect(result.meta.total).toBe(0);
        expect(result.meta.page).toBe(1);
        expect(result.meta.limit).toBe(50);
        expect(result.meta.totalPages).toBe(0);
      });

      it("enriches comments with author name from user lookup", async () => {
        const comment = makeComment({ authorId: USER });
        mockPrisma.comment.findMany.mockReturnValue(Promise.resolve([comment]));
        mockPrisma.comment.count.mockReturnValue(Promise.resolve(1));
        mockPrisma.user.findMany.mockReturnValue(
          Promise.resolve([makeAuthor({ id: USER, name: "Alice Smith" })]),
        );

        const result = await service.findByTarget(
          "update",
          UPDATE_ID,
          ORG,
          USER,
          "owner",
          1,
          50,
        );

        expect(result.data).toHaveLength(1);
        expect(result.data[0].author).toEqual({ id: USER, name: "Alice Smith" });
        expect(result.data[0].id).toBe(COMMENT_ID);
        expect(result.data[0].content).toBe("Test comment");
        expect(result.data[0].createdAt).toBeDefined();
      });

      it("falls back to 'Unknown' when author is not found in user table", async () => {
        const orphanUserId = "deleted-user";
        const comment = makeComment({ authorId: orphanUserId });
        mockPrisma.comment.findMany.mockReturnValue(Promise.resolve([comment]));
        mockPrisma.comment.count.mockReturnValue(Promise.resolve(1));
        // user lookup returns no matching user
        mockPrisma.user.findMany.mockReturnValue(Promise.resolve([]));

        const result = await service.findByTarget(
          "update",
          UPDATE_ID,
          ORG,
          USER,
          "owner",
          1,
          50,
        );

        expect(result.data[0].author).toEqual({ id: orphanUserId, name: "Unknown" });
      });

      it("deduplicates authorId lookups when multiple comments share the same author", async () => {
        const comments = [
          makeComment({ id: "c-1", authorId: USER }),
          makeComment({ id: "c-2", authorId: USER }),
          makeComment({ id: "c-3", authorId: USER }),
        ];
        mockPrisma.comment.findMany.mockReturnValue(Promise.resolve(comments));
        mockPrisma.comment.count.mockReturnValue(Promise.resolve(3));
        mockPrisma.user.findMany.mockReturnValue(
          Promise.resolve([makeAuthor({ id: USER })]),
        );

        await service.findByTarget("update", UPDATE_ID, ORG, USER, "owner", 1, 50);

        // user.findMany should be called once with a deduplicated set of IDs
        expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);
        const userFindArgs = (mockPrisma.user.findMany as ReturnType<typeof mock>).mock.calls[0][0] as PrismaArgs;
        const inIds = (userFindArgs.where?.id as { in: string[] }).in;
        expect(inIds).toHaveLength(1);
        expect(inIds[0]).toBe(USER);
      });

      it("skips user lookup entirely when there are no comments", async () => {
        mockPrisma.comment.findMany.mockReturnValue(Promise.resolve([]));
        mockPrisma.comment.count.mockReturnValue(Promise.resolve(0));

        await service.findByTarget("update", UPDATE_ID, ORG, USER, "owner", 1, 50);

        expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      });

      it("handles multiple authors across different comments", async () => {
        const comments = [
          makeComment({ id: "c-1", authorId: "user-a" }),
          makeComment({ id: "c-2", authorId: "user-b" }),
        ];
        mockPrisma.comment.findMany.mockReturnValue(Promise.resolve(comments));
        mockPrisma.comment.count.mockReturnValue(Promise.resolve(2));
        mockPrisma.user.findMany.mockReturnValue(
          Promise.resolve([
            { id: "user-a", name: "Alice" },
            { id: "user-b", name: "Bob" },
          ]),
        );

        const result = await service.findByTarget(
          "update",
          UPDATE_ID,
          ORG,
          USER,
          "owner",
          1,
          50,
        );

        expect(result.data[0].author.name).toBe("Alice");
        expect(result.data[1].author.name).toBe("Bob");
      });

      it("queries comments filtered by updateId when target type is 'update'", async () => {
        await service.findByTarget("update", UPDATE_ID, ORG, USER, "owner", 1, 50);

        expect(mockPrisma.comment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              organizationId: ORG,
              updateId: UPDATE_ID,
            }),
          }),
        );
        const findManyArgs = (mockPrisma.comment.findMany as ReturnType<typeof mock>).mock.calls[0][0] as PrismaArgs;
        expect(findManyArgs.where).not.toHaveProperty("taskId");
      });

      it("queries comments filtered by taskId when target type is 'task'", async () => {
        await service.findByTarget("task", TASK_ID, ORG, USER, "owner", 1, 50);

        expect(mockPrisma.comment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              organizationId: ORG,
              taskId: TASK_ID,
            }),
          }),
        );
        const findManyArgs = (mockPrisma.comment.findMany as ReturnType<typeof mock>).mock.calls[0][0] as PrismaArgs;
        expect(findManyArgs.where).not.toHaveProperty("updateId");
      });

      it("orders comments by createdAt ascending (chronological order)", async () => {
        await service.findByTarget("update", UPDATE_ID, ORG, USER, "owner", 1, 50);

        expect(mockPrisma.comment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: { createdAt: "asc" },
          }),
        );
      });

      it("applies correct pagination skip and take for page 2 with limit 10", async () => {
        await service.findByTarget("update", UPDATE_ID, ORG, USER, "owner", 2, 10);

        expect(mockPrisma.comment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ skip: 10, take: 10 }),
        );
      });

      it("applies correct pagination skip and take for page 1 with limit 50 (defaults)", async () => {
        await service.findByTarget("update", UPDATE_ID, ORG, USER, "owner", 1, 50);

        expect(mockPrisma.comment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ skip: 0, take: 50 }),
        );
      });

      it("calculates totalPages correctly when comments divide evenly", async () => {
        mockPrisma.comment.findMany.mockReturnValue(Promise.resolve([]));
        mockPrisma.comment.count.mockReturnValue(Promise.resolve(100));

        const result = await service.findByTarget(
          "update",
          UPDATE_ID,
          ORG,
          USER,
          "owner",
          1,
          10,
        );

        expect(result.meta.totalPages).toBe(10);
      });

      it("rounds totalPages up when comments do not divide evenly", async () => {
        mockPrisma.comment.findMany.mockReturnValue(Promise.resolve([]));
        mockPrisma.comment.count.mockReturnValue(Promise.resolve(11));

        const result = await service.findByTarget(
          "update",
          UPDATE_ID,
          ORG,
          USER,
          "owner",
          1,
          10,
        );

        expect(result.meta.totalPages).toBe(2);
      });

      it("returns only id, content, author, and createdAt in each enriched comment", async () => {
        const comment = makeComment();
        mockPrisma.comment.findMany.mockReturnValue(Promise.resolve([comment]));
        mockPrisma.comment.count.mockReturnValue(Promise.resolve(1));
        mockPrisma.user.findMany.mockReturnValue(
          Promise.resolve([makeAuthor()]),
        );

        const result = await service.findByTarget(
          "update",
          UPDATE_ID,
          ORG,
          USER,
          "owner",
          1,
          50,
        );

        const item = result.data[0];
        expect(Object.keys(item)).toEqual(
          expect.arrayContaining(["id", "content", "author", "createdAt"]),
        );
        // Raw DB fields like authorId, organizationId should not be exposed
        expect(item).not.toHaveProperty("authorId");
        expect(item).not.toHaveProperty("organizationId");
      });
    });

    describe("target not found", () => {
      it("throws NotFoundException when update does not exist", async () => {
        mockPrisma.projectUpdate.findFirst.mockReturnValue(Promise.resolve(null));

        try {
          await service.findByTarget("update", "bad-id", ORG, USER, "owner");
          expect(true).toBe(false); // must not reach
        } catch (e) {
          expect(e).toBeInstanceOf(NotFoundException);
          expect((e as NotFoundException).message).toBe("Update not found");
        }
      });

      it("throws NotFoundException when task does not exist", async () => {
        mockPrisma.task.findFirst.mockReturnValue(Promise.resolve(null));

        try {
          await service.findByTarget("task", "bad-id", ORG, USER, "owner");
          expect(true).toBe(false); // must not reach
        } catch (e) {
          expect(e).toBeInstanceOf(NotFoundException);
          expect((e as NotFoundException).message).toBe("Task not found");
        }
      });
    });

    describe("access control", () => {
      it("throws ForbiddenException when 'member' is not assigned to the project", async () => {
        mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));

        try {
          await service.findByTarget("update", UPDATE_ID, ORG, USER, "member");
          expect(true).toBe(false); // must not reach
        } catch (e) {
          expect(e).toBeInstanceOf(ForbiddenException);
        }
      });

      it("does not return comments when access is denied", async () => {
        mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));

        try {
          await service.findByTarget("update", UPDATE_ID, ORG, USER, "member");
        } catch {
          // expected
        }

        expect(mockPrisma.comment.findMany).not.toHaveBeenCalled();
      });

      it("allows 'owner' role to view comments without projectClient check", async () => {
        mockPrisma.comment.count.mockReturnValue(Promise.resolve(0));
        await service.findByTarget("update", UPDATE_ID, ORG, USER, "owner");

        expect(mockPrisma.projectClient.findFirst).not.toHaveBeenCalled();
      });

      it("allows 'admin' role to view comments without projectClient check", async () => {
        mockPrisma.comment.count.mockReturnValue(Promise.resolve(0));
        await service.findByTarget("update", UPDATE_ID, ORG, ADMIN_USER, "admin");

        expect(mockPrisma.projectClient.findFirst).not.toHaveBeenCalled();
      });
    });
  });

  // =========================================================================
  // CommentsService.remove
  // =========================================================================

  describe("remove", () => {
    describe("success paths", () => {
      it("allows a comment author to delete their own comment", async () => {
        mockPrisma.comment.findFirst.mockReturnValue(
          Promise.resolve(makeComment({ authorId: USER })),
        );

        // Should not throw
        await service.remove(COMMENT_ID, ORG, USER, "member");

        expect(mockPrisma.comment.delete).toHaveBeenCalledWith({
          where: { id: COMMENT_ID },
        });
      });

      it("allows an 'admin' to delete another user's comment", async () => {
        mockPrisma.comment.findFirst.mockReturnValue(
          Promise.resolve(makeComment({ authorId: OTHER_USER })),
        );

        await service.remove(COMMENT_ID, ORG, ADMIN_USER, "admin");

        expect(mockPrisma.comment.delete).toHaveBeenCalledWith({
          where: { id: COMMENT_ID },
        });
      });

      it("allows an 'owner' to delete another user's comment", async () => {
        mockPrisma.comment.findFirst.mockReturnValue(
          Promise.resolve(makeComment({ authorId: OTHER_USER })),
        );

        await service.remove(COMMENT_ID, ORG, USER, "owner");

        expect(mockPrisma.comment.delete).toHaveBeenCalledWith({
          where: { id: COMMENT_ID },
        });
      });

      it("returns undefined (void) after successful deletion", async () => {
        mockPrisma.comment.findFirst.mockReturnValue(
          Promise.resolve(makeComment({ authorId: USER })),
        );

        const result = await service.remove(COMMENT_ID, ORG, USER, "member");

        expect(result).toBeUndefined();
      });
    });

    describe("not found", () => {
      it("throws NotFoundException when comment does not exist", async () => {
        mockPrisma.comment.findFirst.mockReturnValue(Promise.resolve(null));

        try {
          await service.remove("nonexistent-comment", ORG, USER, "owner");
          expect(true).toBe(false); // must not reach
        } catch (e) {
          expect(e).toBeInstanceOf(NotFoundException);
          expect((e as NotFoundException).message).toBe("Comment not found");
        }
      });

      it("scopes the comment lookup to the correct organization", async () => {
        mockPrisma.comment.findFirst.mockReturnValue(Promise.resolve(null));

        try {
          await service.remove(COMMENT_ID, ORG, USER, "owner");
        } catch {
          // expected
        }

        expect(mockPrisma.comment.findFirst).toHaveBeenCalledWith({
          where: { id: COMMENT_ID, organizationId: ORG },
        });
      });

      it("does not call delete when comment is not found", async () => {
        mockPrisma.comment.findFirst.mockReturnValue(Promise.resolve(null));

        try {
          await service.remove(COMMENT_ID, ORG, USER, "member");
        } catch {
          // expected
        }

        expect(mockPrisma.comment.delete).not.toHaveBeenCalled();
      });
    });

    describe("access control — non-owner trying to delete another user's comment", () => {
      it("throws ForbiddenException when a 'member' tries to delete another user's comment", async () => {
        mockPrisma.comment.findFirst.mockReturnValue(
          // Comment belongs to OTHER_USER, but requestor is USER with member role
          Promise.resolve(makeComment({ authorId: OTHER_USER })),
        );

        try {
          await service.remove(COMMENT_ID, ORG, USER, "member");
          expect(true).toBe(false); // must not reach
        } catch (e) {
          expect(e).toBeInstanceOf(ForbiddenException);
          expect((e as ForbiddenException).message).toBe("Cannot delete this comment");
        }
      });

      it("does not delete the comment when a 'member' tries to delete another user's comment", async () => {
        mockPrisma.comment.findFirst.mockReturnValue(
          Promise.resolve(makeComment({ authorId: OTHER_USER })),
        );

        try {
          await service.remove(COMMENT_ID, ORG, USER, "member");
        } catch {
          // expected
        }

        expect(mockPrisma.comment.delete).not.toHaveBeenCalled();
      });

      it("allows deletion when requestor is the author even with 'member' role", async () => {
        mockPrisma.comment.findFirst.mockReturnValue(
          Promise.resolve(makeComment({ authorId: USER })),
        );

        // Same user as author — should succeed regardless of role
        await service.remove(COMMENT_ID, ORG, USER, "member");

        expect(mockPrisma.comment.delete).toHaveBeenCalled();
      });

      it("role check treats 'owner' as privileged (can delete any comment)", async () => {
        mockPrisma.comment.findFirst.mockReturnValue(
          Promise.resolve(makeComment({ authorId: "completely-different-user" })),
        );

        await service.remove(COMMENT_ID, ORG, USER, "owner");

        expect(mockPrisma.comment.delete).toHaveBeenCalled();
      });

      it("role check treats 'admin' as privileged (can delete any comment)", async () => {
        mockPrisma.comment.findFirst.mockReturnValue(
          Promise.resolve(makeComment({ authorId: "completely-different-user" })),
        );

        await service.remove(COMMENT_ID, ORG, ADMIN_USER, "admin");

        expect(mockPrisma.comment.delete).toHaveBeenCalled();
      });
    });
  });

  // =========================================================================
  // CommentsController delegation
  // =========================================================================
});

// ---------------------------------------------------------------------------
// CommentsController — parameter routing and delegation
// ---------------------------------------------------------------------------

import { describe as describeCtrl, expect as expectCtrl, it as itCtrl, mock as mockCtrl, beforeEach as beforeEachCtrl } from "bun:test";
import { CommentsController } from "./comments.controller";
import type { CommentsService as CommentsServiceType } from "./comments.service";

describeCtrl("CommentsController", () => {
  let controller: CommentsController;
  let commentsService: {
    create: ReturnType<typeof mockCtrl>;
    findByTarget: ReturnType<typeof mockCtrl>;
    remove: ReturnType<typeof mockCtrl>;
  };

  const orgId = ORG;
  const userId = USER;
  const role = "owner";
  const paginationDefault = { page: 1, limit: 50 };

  beforeEachCtrl(() => {
    commentsService = {
      create: mockCtrl(() => Promise.resolve({ id: COMMENT_ID, content: "x" })),
      findByTarget: mockCtrl(() => Promise.resolve({ data: [], meta: {} })),
      remove: mockCtrl(() => Promise.resolve()),
    };
    controller = new CommentsController(commentsService as unknown as CommentsServiceType);
  });

  // --- POST /comments/update/:updateId ---

  itCtrl("createOnUpdate delegates to CommentsService.create with target type 'update'", async () => {
    await controller.createOnUpdate(
      UPDATE_ID,
      { content: "Hello update" },
      orgId,
      userId,
      role,
    );

    expectCtrl(commentsService.create).toHaveBeenCalledWith(
      "update",
      UPDATE_ID,
      "Hello update",
      orgId,
      userId,
      role,
    );
  });

  // --- POST /comments/task/:taskId ---

  itCtrl("createOnTask delegates to CommentsService.create with target type 'task'", async () => {
    await controller.createOnTask(
      TASK_ID,
      { content: "Hello task" },
      orgId,
      userId,
      role,
    );

    expectCtrl(commentsService.create).toHaveBeenCalledWith(
      "task",
      TASK_ID,
      "Hello task",
      orgId,
      userId,
      role,
    );
  });

  // --- GET /comments/update/:updateId ---

  itCtrl("findByUpdate delegates to CommentsService.findByTarget with target type 'update'", async () => {
    await controller.findByUpdate(UPDATE_ID, orgId, userId, role, paginationDefault);

    expectCtrl(commentsService.findByTarget).toHaveBeenCalledWith(
      "update",
      UPDATE_ID,
      orgId,
      userId,
      role,
      1,
      50,
    );
  });

  itCtrl("findByUpdate passes custom pagination values to CommentsService", async () => {
    await controller.findByUpdate(UPDATE_ID, orgId, userId, role, { page: 3, limit: 20 });

    expectCtrl(commentsService.findByTarget).toHaveBeenCalledWith(
      "update",
      UPDATE_ID,
      orgId,
      userId,
      role,
      3,
      20,
    );
  });

  // --- GET /comments/task/:taskId ---

  itCtrl("findByTask delegates to CommentsService.findByTarget with target type 'task'", async () => {
    await controller.findByTask(TASK_ID, orgId, userId, role, paginationDefault);

    expectCtrl(commentsService.findByTarget).toHaveBeenCalledWith(
      "task",
      TASK_ID,
      orgId,
      userId,
      role,
      1,
      50,
    );
  });

  itCtrl("findByTask passes custom pagination values to CommentsService", async () => {
    await controller.findByTask(TASK_ID, orgId, userId, role, { page: 2, limit: 25 });

    expectCtrl(commentsService.findByTarget).toHaveBeenCalledWith(
      "task",
      TASK_ID,
      orgId,
      userId,
      role,
      2,
      25,
    );
  });

  // --- DELETE /comments/:id ---

  itCtrl("remove delegates to CommentsService.remove with correct parameters", async () => {
    await controller.remove(COMMENT_ID, orgId, userId, role);

    expectCtrl(commentsService.remove).toHaveBeenCalledWith(
      COMMENT_ID,
      orgId,
      userId,
      role,
    );
  });

  itCtrl("remove returns the result from CommentsService.remove", async () => {
    commentsService.remove.mockImplementation(() => Promise.resolve(undefined));

    const result = await controller.remove(COMMENT_ID, orgId, userId, role);

    expectCtrl(result).toBeUndefined();
  });

  itCtrl("createOnUpdate returns the created comment from CommentsService", async () => {
    const created = { id: "new-comment", content: "fresh comment" };
    commentsService.create.mockImplementation(() => Promise.resolve(created));

    const result = await controller.createOnUpdate(
      UPDATE_ID,
      { content: "fresh comment" },
      orgId,
      userId,
      role,
    );

    expectCtrl(result).toEqual(created);
  });

  itCtrl("createOnTask returns the created comment from CommentsService", async () => {
    const created = { id: "new-task-comment", content: "task note" };
    commentsService.create.mockImplementation(() => Promise.resolve(created));

    const result = await controller.createOnTask(
      TASK_ID,
      { content: "task note" },
      orgId,
      userId,
      role,
    );

    expectCtrl(result).toEqual(created);
  });

  itCtrl("findByUpdate returns the paginated result from CommentsService", async () => {
    const paginated = {
      data: [{ id: "c-1", content: "x", author: { id: USER, name: "Alice" }, createdAt: new Date() }],
      meta: { total: 1, page: 1, limit: 50, totalPages: 1 },
    };
    commentsService.findByTarget.mockImplementation(() => Promise.resolve(paginated));

    const result = await controller.findByUpdate(UPDATE_ID, orgId, userId, role, paginationDefault);

    expectCtrl(result).toEqual(paginated);
  });
});
