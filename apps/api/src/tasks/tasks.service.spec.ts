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
