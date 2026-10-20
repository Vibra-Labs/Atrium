import { describe, expect, it, mock, beforeEach } from "bun:test";
import { NotFoundException, ConflictException, BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { LabelsService } from "./labels.service";
import { DEFAULT_LABEL_COLOR } from "@atrium/shared";

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
    findFirst: mock(() => Promise.resolve({ id: "member-1", userId: "user-1", role: "member" } as unknown)),
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
  contact: {
    findFirst: mock(() => Promise.resolve({ id: "contact-1" })),
  },
  contactLabel: {
    create: mock(() => Promise.resolve({ id: "cl-1" })),
    deleteMany: mock(() => Promise.resolve({ count: 1 })),
  },
  memberLabel: {
    create: mock(() => Promise.resolve({ id: "ml-1" })),
    deleteMany: mock(() => Promise.resolve({ count: 1 })),
  },
};

const mockSync = {
  ensureForMember: mock(() => Promise.resolve({ id: "contact-m" })),
};

function clearMocks() {
  for (const model of Object.values(mockPrisma)) {
    for (const fn of Object.values(model)) {
      (fn as ReturnType<typeof mock>).mockClear();
    }
  }
  mockSync.ensureForMember.mockClear();
  // Reset defaults
  mockPrisma.label.findFirst.mockImplementation(() => Promise.resolve({ id: "lbl-1", name: "Bug", color: "#ef4444", organizationId: "org-1" }));
  mockPrisma.project.findFirst.mockImplementation(() => Promise.resolve({ id: "proj-1" }));
  mockPrisma.task.findFirst.mockImplementation(() => Promise.resolve({ id: "task-1" }));
  mockPrisma.file.findFirst.mockImplementation(() => Promise.resolve({ id: "file-1" }));
  mockPrisma.member.findFirst.mockImplementation(() => Promise.resolve({ id: "member-1", userId: "user-1", role: "member" }));
  mockPrisma.memberLabel.create.mockImplementation(() => Promise.resolve({ id: "ml-1" }));
}

describe("LabelsService", () => {
  let service: LabelsService;

  beforeEach(() => {
    clearMocks();
    service = new LabelsService(mockPrisma as unknown as PrismaService, mockSync as never);
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
        data: { name: "Bug", color: DEFAULT_LABEL_COLOR, organizationId: "org-1" },
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

  describe("contact and member tags", () => {
    it("assign contact label", async () => {
      await service.assign("lbl-1", { entityType: "contact", entityId: "contact-1" }, "org-1");
      expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith({
        where: { id: "contact-1", organizationId: "org-1" },
        select: { id: true },
      });
      expect(mockPrisma.contactLabel.create).toHaveBeenCalledWith({
        data: { contactId: "contact-1", labelId: "lbl-1" },
      });
    });

    it("assign contact label rejects a contact from another org", async () => {
      mockPrisma.contact.findFirst.mockImplementationOnce(() => Promise.resolve(null));
      await expect(
        service.assign("lbl-1", { entityType: "contact", entityId: "c-x" }, "org-1"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("assign member label writes ContactLabel", async () => {
      await service.assign("lbl-1", { entityType: "member", entityId: "member-1" }, "org-1");
      expect(mockSync.ensureForMember).toHaveBeenCalledWith("org-1", "user-1");
      expect(mockPrisma.contactLabel.create).toHaveBeenCalledWith({
        data: { contactId: "contact-m", labelId: "lbl-1" },
      });
      expect(mockPrisma.memberLabel.create).not.toHaveBeenCalled();
    });

    it("assign member label 400s when a client has no contact", async () => {
      mockSync.ensureForMember.mockImplementationOnce(() => Promise.resolve(null as never));
      await expect(
        service.assign("lbl-1", { entityType: "member", entityId: "member-1" }, "org-1"),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.contactLabel.create).not.toHaveBeenCalled();
    });

    for (const role of ["owner", "admin"]) {
      it(`assign member label on ${role} writes MemberLabel`, async () => {
        mockPrisma.member.findFirst.mockImplementation(() =>
          Promise.resolve({ id: "member-1", userId: "user-1", role }),
        );
        await service.assign("lbl-1", { entityType: "member", entityId: "member-1" }, "org-1");
        expect(mockPrisma.memberLabel.create).toHaveBeenCalledWith({
          data: { memberId: "member-1", labelId: "lbl-1" },
        });
        expect(mockSync.ensureForMember).not.toHaveBeenCalled();
        expect(mockPrisma.contactLabel.create).not.toHaveBeenCalled();
      });
    }

    it("assign member label on staff 409s on a duplicate", async () => {
      mockPrisma.member.findFirst.mockImplementation(() =>
        Promise.resolve({ id: "member-1", userId: "user-1", role: "admin" }),
      );
      mockPrisma.memberLabel.create.mockImplementation(() => Promise.reject({ code: "P2002" }));
      await expect(
        service.assign("lbl-1", { entityType: "member", entityId: "member-1" }, "org-1"),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("unassign member label on staff deletes MemberLabel only", async () => {
      mockPrisma.member.findFirst.mockImplementation(() =>
        Promise.resolve({ id: "member-1", userId: "user-1", role: "owner" }),
      );
      await service.unassign("lbl-1", { entityType: "member", entityId: "member-1" }, "org-1");
      expect(mockPrisma.memberLabel.deleteMany).toHaveBeenCalledWith({
        where: { memberId: "member-1", labelId: "lbl-1" },
      });
      expect(mockPrisma.contact.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.contactLabel.deleteMany).not.toHaveBeenCalled();
    });

    it("unassign member label removes ContactLabel and any legacy MemberLabel", async () => {
      mockPrisma.contact.findFirst.mockImplementationOnce(() => Promise.resolve({ id: "contact-m" }));
      await service.unassign("lbl-1", { entityType: "member", entityId: "member-1" }, "org-1");
      expect(mockPrisma.contactLabel.deleteMany).toHaveBeenCalledWith({
        where: { contactId: "contact-m", labelId: "lbl-1" },
      });
      expect(mockPrisma.memberLabel.deleteMany).toHaveBeenCalledWith({
        where: { memberId: "member-1", labelId: "lbl-1" },
      });
    });

    it("unassign contact label removes ContactLabel and the linked member's MemberLabel", async () => {
      mockPrisma.contact.findFirst.mockImplementationOnce(() =>
        Promise.resolve({ id: "contact-1", userId: "user-1" }),
      );
      await service.unassign("lbl-1", { entityType: "contact", entityId: "contact-1" }, "org-1");
      expect(mockPrisma.contactLabel.deleteMany).toHaveBeenCalledWith({
        where: { contactId: "contact-1", labelId: "lbl-1" },
      });
      expect(mockPrisma.memberLabel.deleteMany).toHaveBeenCalledWith({
        where: { labelId: "lbl-1", member: { organizationId: "org-1", userId: "user-1", role: "member" } },
      });
    });

    it("unassign contact label without a linked user leaves MemberLabel alone", async () => {
      mockPrisma.contact.findFirst.mockImplementationOnce(() =>
        Promise.resolve({ id: "contact-1", userId: null }),
      );
      await service.unassign("lbl-1", { entityType: "contact", entityId: "contact-1" }, "org-1");
      expect(mockPrisma.memberLabel.deleteMany).not.toHaveBeenCalled();
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
