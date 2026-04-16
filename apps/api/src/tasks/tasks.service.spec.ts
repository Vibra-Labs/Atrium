import { describe, it, expect, mock, beforeEach } from "bun:test";
import { TasksService } from "./tasks.service";
import { ForbiddenException, BadRequestException } from "@nestjs/common";

describe("TasksService", () => {
  let service: TasksService;
  const mockNotifications = {
    notifyClientRequestCreated: mock(() => {}),
    notifyTaskCreated: mock(() => {}),
    notifyTaskStatusChanged: mock(() => {}),
    notifyTaskAssigned: mock(() => {}),
    notifyDecisionClosed: mock(() => {}),
  };
  const mockActivity = { create: mock(() => Promise.resolve()) };
  const mockLogger = { warn: mock(() => {}), error: mock(() => {}) };

  describe("createForClient", () => {
    beforeEach(() => {
      const mockPrisma = {
        project: { findFirst: mock(() => ({ id: "proj1", organizationId: "org1" })) },
        projectClient: {
          findFirst: mock(() => ({
            projectId: "proj1",
            userId: "client1",
            user: { name: "Alice" },
          })),
        },
        task: {
          aggregate: mock(() => ({ _max: { order: null } })),
          create: mock(() => ({
            id: "task1",
            title: "Fix the logo",
            status: "open",
            requestedById: "client1",
            type: "checkbox",
          })),
        },
      };
      service = new TasksService(
        mockPrisma as never,
        mockNotifications as never,
        mockActivity as never,
        mockLogger as never,
      );
    });

    it("creates a task with status=open and requestedById set to caller", async () => {
      const result = await service.createForClient(
        { title: "Fix the logo" },
        "proj1",
        "client1",
        "org1",
      );
      expect(result.status).toBe("open");
      expect(result.requestedById).toBe("client1");
      expect(mockNotifications.notifyClientRequestCreated).toHaveBeenCalled();
    });

    it("throws ForbiddenException if client is not assigned to the project", async () => {
      const mockPrismaForbidden = {
        project: { findFirst: mock(() => ({ id: "proj1", organizationId: "org1" })) },
        projectClient: { findFirst: mock(() => null) },
        task: { aggregate: mock(() => ({ _max: { order: null } })), create: mock(() => {}) },
      };
      const restrictedService = new TasksService(
        mockPrismaForbidden as never,
        mockNotifications as never,
        mockActivity as never,
        mockLogger as never,
      );
      await expect(
        restrictedService.createForClient({ title: "Fix the logo" }, "proj1", "other-user", "org1"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("create", () => {
    it("creates a task with requestedById=null when no requestedById arg is passed", async () => {
      const mockPrisma = {
        project: { findFirst: mock(() => ({ id: "proj1", organizationId: "org1" })) },
        task: {
          aggregate: mock(() => ({ _max: { order: null } })),
          create: mock(() => ({
            id: "task1",
            title: "Agency Task",
            status: "open",
            requestedById: null,
            type: "checkbox",
          })),
        },
      };
      service = new TasksService(
        mockPrisma as never,
        mockNotifications as never,
        mockActivity as never,
        mockLogger as never,
      );
      const result = await service.create({ title: "Agency Task" }, "proj1", "org1");
      expect(result.requestedById).toBeNull();
    });
  });

  describe("findByProject", () => {
    function makeService(tasks: object[], memberUserIds: string[]): TasksService {
      const mockPrisma = {
        task: {
          findMany: mock(() => Promise.resolve(tasks)),
          count: mock(() => Promise.resolve(tasks.length)),
        },
        member: {
          findMany: mock(() =>
            Promise.resolve(memberUserIds.map((userId) => ({ userId }))),
          ),
        },
      };
      return new TasksService(
        mockPrisma as never,
        mockNotifications as never,
        mockActivity as never,
        mockLogger as never,
      );
    }

    it("returns only open and in_progress tasks when status=active", async () => {
      const tasks = [
        { id: "t1", status: "open", requestedById: null, options: [], labels: [], _count: { votes: 0, comments: 0 } },
        { id: "t2", status: "in_progress", requestedById: null, options: [], labels: [], _count: { votes: 0, comments: 0 } },
      ];
      const svc = makeService(tasks, []);
      const result = await svc.findByProject("proj1", "org1", 1, 20, "active");
      expect(result.data).toHaveLength(2);
      for (const task of result.data) {
        expect(["open", "in_progress"]).toContain(task.status);
      }
    });

    it("returns only done tasks when status=done", async () => {
      const tasks = [
        { id: "t3", status: "done", requestedById: null, options: [], labels: [], _count: { votes: 0, comments: 0 } },
      ];
      const svc = makeService(tasks, []);
      const result = await svc.findByProject("proj1", "org1", 1, 20, "done");
      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe("done");
    });

    it("returns all tasks when status=all", async () => {
      const tasks = [
        { id: "t1", status: "open", requestedById: null, options: [], labels: [], _count: { votes: 0, comments: 0 } },
        { id: "t2", status: "done", requestedById: null, options: [], labels: [], _count: { votes: 0, comments: 0 } },
        { id: "t3", status: "cancelled", requestedById: null, options: [], labels: [], _count: { votes: 0, comments: 0 } },
      ];
      const svc = makeService(tasks, []);
      const result = await svc.findByProject("proj1", "org1", 1, 20, "all");
      expect(result.data).toHaveLength(3);
    });

    it("returns all tasks when status is undefined", async () => {
      const tasks = [
        { id: "t1", status: "open", requestedById: null, options: [], labels: [], _count: { votes: 0, comments: 0 } },
        { id: "t2", status: "done", requestedById: null, options: [], labels: [], _count: { votes: 0, comments: 0 } },
      ];
      const svc = makeService(tasks, []);
      const result = await svc.findByProject("proj1", "org1", 1, 20, undefined);
      expect(result.data).toHaveLength(2);
    });

    it("sets isClientRequest=true when requestedById is a non-member", async () => {
      const tasks = [
        { id: "t1", status: "open", requestedById: "client1", options: [], labels: [], _count: { votes: 0, comments: 0 } },
      ];
      // "client1" is NOT in the member list
      const svc = makeService(tasks, ["member1"]);
      const result = await svc.findByProject("proj1", "org1", 1, 20);
      expect(result.data[0].isClientRequest).toBe(true);
    });

    it("sets isClientRequest=false when requestedById is an org member", async () => {
      const tasks = [
        { id: "t1", status: "open", requestedById: "member1", options: [], labels: [], _count: { votes: 0, comments: 0 } },
      ];
      const svc = makeService(tasks, ["member1"]);
      const result = await svc.findByProject("proj1", "org1", 1, 20);
      expect(result.data[0].isClientRequest).toBe(false);
    });

    it("sets isClientRequest=false when requestedById is null", async () => {
      const tasks = [
        { id: "t1", status: "open", requestedById: null, options: [], labels: [], _count: { votes: 0, comments: 0 } },
      ];
      const svc = makeService(tasks, ["member1"]);
      const result = await svc.findByProject("proj1", "org1", 1, 20);
      expect(result.data[0].isClientRequest).toBe(false);
    });
  });

  describe("update — assigneeId validation and notifications", () => {
    const baseTask = {
      id: "task1",
      title: "My Task",
      status: "open",
      assigneeId: null,
      requestedById: null,
      projectId: "proj1",
      organizationId: "org1",
    };

    function makeUpdateService(
      existingTask: object | null,
      memberExists: boolean,
      updatedTask: object,
    ): TasksService {
      const mockPrisma = {
        task: {
          findFirst: mock(() => Promise.resolve(existingTask)),
          update: mock(() => Promise.resolve(updatedTask)),
        },
        member: {
          findFirst: mock(() =>
            Promise.resolve(memberExists ? { userId: "user2" } : null),
          ),
        },
      };
      return new TasksService(
        mockPrisma as never,
        mockNotifications as never,
        mockActivity as never,
        mockLogger as never,
      );
    }

    beforeEach(() => {
      mockNotifications.notifyTaskAssigned.mockClear();
      mockNotifications.notifyTaskStatusChanged.mockClear();
    });

    it("throws BadRequestException when assigneeId is not an org member", async () => {
      const svc = makeUpdateService(baseTask, false, {});
      await expect(
        svc.update("task1", { assigneeId: "non-member" }, "org1"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("accepts a valid assigneeId that is an org member", async () => {
      const updated = { ...baseTask, assigneeId: "user2" };
      const svc = makeUpdateService(baseTask, true, updated);
      const result = await svc.update("task1", { assigneeId: "user2" }, "org1");
      expect(result.assigneeId).toBe("user2");
    });

    it("fires notifyTaskAssigned when assignee changes", async () => {
      const updated = { ...baseTask, assigneeId: "user2" };
      const svc = makeUpdateService(baseTask, true, updated);
      await svc.update("task1", { assigneeId: "user2" }, "org1");
      expect(mockNotifications.notifyTaskAssigned).toHaveBeenCalledTimes(1);
    });

    it("does NOT fire notifyTaskAssigned when same assignee is set again", async () => {
      const taskWithAssignee = { ...baseTask, assigneeId: "user2" };
      const updated = { ...taskWithAssignee };
      const svc = makeUpdateService(taskWithAssignee, true, updated);
      await svc.update("task1", { assigneeId: "user2" }, "org1");
      expect(mockNotifications.notifyTaskAssigned).not.toHaveBeenCalled();
    });

    it("fires notifyTaskStatusChanged when status changes", async () => {
      const updated = { ...baseTask, status: "in_progress", assigneeId: null };
      const svc = makeUpdateService(baseTask, false, updated);
      await svc.update("task1", { status: "in_progress" }, "org1");
      expect(mockNotifications.notifyTaskStatusChanged).toHaveBeenCalledTimes(1);
    });

    it("does NOT fire notifyTaskStatusChanged when status is unchanged", async () => {
      const updated = { ...baseTask };
      const svc = makeUpdateService(baseTask, false, updated);
      // baseTask.status is already "open", passing same value
      await svc.update("task1", { status: "open" }, "org1");
      expect(mockNotifications.notifyTaskStatusChanged).not.toHaveBeenCalled();
    });
  });

  describe("cancelClientTask", () => {
    it("cancels an open task when the requester calls it", async () => {
      const mockPrisma = {
        task: {
          findFirst: mock(() => ({
            id: "task1",
            title: "Logo fix",
            status: "open",
            requestedById: "client1",
            projectId: "proj1",
            organizationId: "org1",
          })),
          update: mock(() => ({ id: "task1", status: "cancelled" })),
        },
      };
      service = new TasksService(
        mockPrisma as never,
        mockNotifications as never,
        mockActivity as never,
        mockLogger as never,
      );
      const result = await service.cancelClientTask("task1", "client1", "org1");
      expect(result.status).toBe("cancelled");
    });

    it("throws ForbiddenException if a different user tries to cancel", async () => {
      const mockPrisma = {
        task: {
          findFirst: mock(() => ({
            id: "task1",
            title: "Logo fix",
            status: "open",
            requestedById: "client1",
            projectId: "proj1",
            organizationId: "org1",
          })),
          update: mock(() => {}),
        },
      };
      service = new TasksService(
        mockPrisma as never,
        mockNotifications as never,
        mockActivity as never,
        mockLogger as never,
      );
      await expect(
        service.cancelClientTask("task1", "other-user", "org1"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("throws BadRequestException if task is not open", async () => {
      const mockPrisma = {
        task: {
          findFirst: mock(() => ({
            id: "task1",
            title: "Logo fix",
            status: "done",
            requestedById: "client1",
            projectId: "proj1",
            organizationId: "org1",
          })),
          update: mock(() => {}),
        },
      };
      service = new TasksService(
        mockPrisma as never,
        mockNotifications as never,
        mockActivity as never,
        mockLogger as never,
      );
      await expect(
        service.cancelClientTask("task1", "client1", "org1"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
