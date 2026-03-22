import { describe, expect, it, mock, beforeEach } from "bun:test";
import { NotFoundException, ConflictException, BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { LabelsService } from "./labels.service";

const mockPrisma = {
  label: {
    findMany: mock(() => Promise.resolve([])),
    findFirst: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: "lbl-1", name: "Bug", color: "#ef4444", organizationId: "org-1" })),
    update: mock(() => Promise.resolve({ id: "lbl-1", name: "Updated", color: "#ef4444" })),
    delete: mock(() => Promise.resolve()),
  },
  project: {
    findFirst: mock(() => Promise.resolve({ id: "proj-1" })),
  },
  task: {
    findFirst: mock(() => Promise.resolve({ id: "task-1" })),
  },
  file: {
    findFirst: mock(() => Promise.resolve({ id: "file-1" })),
  },
  member: {
    findFirst: mock(() => Promise.resolve({ id: "member-1" })),
  },
  projectLabel: {
    create: mock(() => Promise.resolve({ id: "pl-1" })),
    deleteMany: mock(() => Promise.resolve({ count: 1 })),
  },
  taskLabel: {
    create: mock(() => Promise.resolve({ id: "tl-1" })),
    deleteMany: mock(() => Promise.resolve({ count: 1 })),
  },
  fileLabel: {
    create: mock(() => Promise.resolve({ id: "fl-1" })),
    deleteMany: mock(() => Promise.resolve({ count: 1 })),
  },
  memberLabel: {
    create: mock(() => Promise.resolve({ id: "ml-1" })),
    deleteMany: mock(() => Promise.resolve({ count: 1 })),
  },
};

function clearMocks() {
  for (const model of Object.values(mockPrisma)) {
    for (const fn of Object.values(model)) {
      (fn as ReturnType<typeof mock>).mockClear();
    }
  }
  // Reset defaults
  mockPrisma.label.findFirst.mockImplementation(() => Promise.resolve({ id: "lbl-1", name: "Bug", color: "#ef4444", organizationId: "org-1" }));
  mockPrisma.project.findFirst.mockImplementation(() => Promise.resolve({ id: "proj-1" }));
  mockPrisma.task.findFirst.mockImplementation(() => Promise.resolve({ id: "task-1" }));
  mockPrisma.file.findFirst.mockImplementation(() => Promise.resolve({ id: "file-1" }));
  mockPrisma.member.findFirst.mockImplementation(() => Promise.resolve({ id: "member-1" }));
}

describe("LabelsService", () => {
  let service: LabelsService;

  beforeEach(() => {
    clearMocks();
    service = new LabelsService(mockPrisma as unknown as PrismaService);
  });

  describe("findAll", () => {
    it("returns labels for org", async () => {
      const labels = [{ id: "lbl-1", name: "Bug", color: "#ef4444" }];
      mockPrisma.label.findMany.mockImplementation(() => Promise.resolve(labels));

      const result = await service.findAll("org-1");
      expect(result).toEqual(labels);
      expect(mockPrisma.label.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1" },
        orderBy: { name: "asc" },
      });
    });
  });

  describe("create", () => {
    it("creates a label with default color", async () => {
      await service.create({ name: "Bug" }, "org-1");
      expect(mockPrisma.label.create).toHaveBeenCalledWith({
        data: { name: "Bug", color: "#6b7280", organizationId: "org-1" },
      });
    });

    it("throws ConflictException on duplicate name", async () => {
      mockPrisma.label.create.mockImplementation(() =>
        Promise.reject({ code: "P2002" }),
      );

      try {
        await service.create({ name: "Bug" }, "org-1");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ConflictException);
      }
    });
  });

  describe("update", () => {
    it("throws NotFoundException when label not found", async () => {
      mockPrisma.label.findFirst.mockImplementation(() => Promise.resolve(null));

      try {
        await service.update("lbl-999", { name: "New" }, "org-1");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
      }
    });

    it("updates label name", async () => {
      await service.update("lbl-1", { name: "Feature" }, "org-1");
      expect(mockPrisma.label.update).toHaveBeenCalledWith({
        where: { id: "lbl-1" },
        data: { name: "Feature" },
      });
    });
  });

  describe("remove", () => {
    it("deletes label", async () => {
      await service.remove("lbl-1", "org-1");
      expect(mockPrisma.label.delete).toHaveBeenCalledWith({ where: { id: "lbl-1" } });
    });

    it("throws NotFoundException when label not found", async () => {
      mockPrisma.label.findFirst.mockImplementation(() => Promise.resolve(null));

      try {
        await service.remove("lbl-999", "org-1");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
      }
    });
  });

  describe("assign", () => {
    it("assigns label to project", async () => {
      await service.assign("lbl-1", { entityType: "project", entityId: "proj-1" }, "org-1");
      expect(mockPrisma.projectLabel.create).toHaveBeenCalledWith({
        data: { projectId: "proj-1", labelId: "lbl-1" },
      });
    });

    it("assigns label to task", async () => {
      await service.assign("lbl-1", { entityType: "task", entityId: "task-1" }, "org-1");
      expect(mockPrisma.taskLabel.create).toHaveBeenCalled();
    });

    it("throws NotFoundException when label not found", async () => {
      mockPrisma.label.findFirst.mockImplementation(() => Promise.resolve(null));

      try {
        await service.assign("lbl-999", { entityType: "project", entityId: "proj-1" }, "org-1");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
      }
    });

    it("throws BadRequestException when entity not found", async () => {
      mockPrisma.project.findFirst.mockImplementation(() => Promise.resolve(null));

      try {
        await service.assign("lbl-1", { entityType: "project", entityId: "proj-999" }, "org-1");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
      }
    });
  });

  describe("unassign", () => {
    it("unassigns label from project", async () => {
      await service.unassign("lbl-1", { entityType: "project", entityId: "proj-1" }, "org-1");
      expect(mockPrisma.projectLabel.deleteMany).toHaveBeenCalledWith({
        where: { projectId: "proj-1", labelId: "lbl-1" },
      });
    });
  });
});
