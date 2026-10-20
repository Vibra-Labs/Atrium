import { describe, expect, it, mock, beforeEach } from "bun:test";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { LeadSourcesService } from "./lead-sources.service";

const mockPrisma = {
  leadSource: {
    findMany: mock(() => Promise.resolve([])),
    findFirst: mock(() => Promise.resolve(null)),
    update: mock(() => Promise.resolve({ id: "ls-1", name: "Podcast" })),
    delete: mock(() => Promise.resolve({})),
  },
};
const mockContacts = {
  findOrCreateLeadSource: mock(() => Promise.resolve({ id: "ls-1", name: "Referral" })),
};

describe("LeadSourcesService", () => {
  let service: LeadSourcesService;

  beforeEach(() => {
    for (const fn of [...Object.values(mockPrisma.leadSource), mockContacts.findOrCreateLeadSource]) {
      (fn as ReturnType<typeof mock>).mockReset();
    }
    mockPrisma.leadSource.findMany.mockImplementation(() => Promise.resolve([]));
    mockPrisma.leadSource.findFirst.mockImplementation(() => Promise.resolve(null));
    mockPrisma.leadSource.update.mockImplementation(() => Promise.resolve({ id: "ls-1", name: "Podcast" }));
    mockContacts.findOrCreateLeadSource.mockImplementation(() =>
      Promise.resolve({ id: "ls-1", name: "Referral" }),
    );
    service = new LeadSourcesService(mockPrisma as never, mockContacts as never);
  });

  it("lists sources for the org by name", async () => {
    await service.findAll("org-1");
    expect(mockPrisma.leadSource.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      orderBy: { name: "asc" },
    });
  });

  it("lead source create returns existing on case-insensitive match", async () => {
    const result = await service.create({ name: "  referral " }, "org-1");
    expect(mockContacts.findOrCreateLeadSource).toHaveBeenCalledWith("referral", "org-1");
    expect(result).toEqual({ id: "ls-1", name: "Referral" });
  });

  it("create and rename reject blank or whitespace-only names with 400", async () => {
    for (const name of ["", "   "]) {
      await expect(service.create({ name }, "org-1")).rejects.toBeInstanceOf(BadRequestException);
      mockPrisma.leadSource.findFirst.mockImplementationOnce(() => Promise.resolve({ id: "ls-1", name: "Podcast" }));
      await expect(service.update("ls-1", { name }, "org-1")).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(mockContacts.findOrCreateLeadSource).not.toHaveBeenCalled();
    expect(mockPrisma.leadSource.update).not.toHaveBeenCalled();
  });

  it("rename to existing name 409", async () => {
    mockPrisma.leadSource.findFirst
      .mockImplementationOnce(() => Promise.resolve({ id: "ls-1", name: "Podcast" }))
      .mockImplementationOnce(() => Promise.resolve({ id: "ls-2", name: "Website" }));
    await expect(service.update("ls-1", { name: "website" }, "org-1")).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mockPrisma.leadSource.update).not.toHaveBeenCalled();
  });

  it("rename allows changing only the case of its own name", async () => {
    mockPrisma.leadSource.findFirst
      .mockImplementationOnce(() => Promise.resolve({ id: "ls-1", name: "Podcast" }))
      .mockImplementationOnce(() => Promise.resolve({ id: "ls-1", name: "Podcast" }));
    await service.update("ls-1", { name: "PODCAST" }, "org-1");
    expect(mockPrisma.leadSource.update).toHaveBeenCalled();
  });

  it("rename maps a unique-violation race to 409", async () => {
    mockPrisma.leadSource.findFirst
      .mockImplementationOnce(() => Promise.resolve({ id: "ls-1", name: "Podcast" }))
      .mockImplementationOnce(() => Promise.resolve(null));
    mockPrisma.leadSource.update.mockImplementation(() => Promise.reject({ code: "P2002" }));
    await expect(service.update("ls-1", { name: "Web" }, "org-1")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("update and remove 404 for another org's source", async () => {
    await expect(service.update("x", { name: "A" }, "org-1")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove("x", "org-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("remove deletes an owned source", async () => {
    mockPrisma.leadSource.findFirst.mockImplementationOnce(() => Promise.resolve({ id: "ls-1", name: "A" }));
    await service.remove("ls-1", "org-1");
    expect(mockPrisma.leadSource.delete).toHaveBeenCalledWith({ where: { id: "ls-1" } });
  });
});
