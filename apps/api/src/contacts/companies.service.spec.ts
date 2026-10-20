import { describe, expect, it, mock, beforeEach } from "bun:test";
import { ConflictException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { CompaniesService } from "./companies.service";
import type { ContactRevenueService } from "./contact-revenue.service";

const prisma = {
  company: {
    findFirst: mock(() => Promise.resolve(null as unknown)),
    findMany: mock(() => Promise.resolve([] as unknown[])),
    count: mock(() => Promise.resolve(0)),
    create: mock(() => Promise.resolve({ id: "co-1" })),
    update: mock(() => Promise.resolve({ id: "co-1" })),
    delete: mock(() => Promise.resolve({})),
  },
  contact: { updateMany: mock(() => Promise.resolve({ count: 2 })) },
  $transaction: mock((ops: Promise<unknown>[]) => Promise.all(ops)),
};
const revenue = {
  forCompany: mock(() => Promise.resolve({ paidCents: 0, outstandingCents: 0, monthly: [] })),
  paidTotalsForCompanies: mock(() => Promise.resolve(new Map<string, number>([["co-1", 1234]]))),
};

describe("CompaniesService", () => {
  let service: CompaniesService;
  beforeEach(() => {
    prisma.company.findFirst.mockReset();
    prisma.company.findFirst.mockImplementation(() => Promise.resolve(null));
    prisma.company.create.mockClear();
    prisma.company.delete.mockClear();
    prisma.company.update.mockClear();
    prisma.contact.updateMany.mockClear();
    service = new CompaniesService(
      prisma as unknown as PrismaService,
      revenue as unknown as ContactRevenueService,
    );
  });

  it("findAll adds paidCents per company, 0 when none", async () => {
    prisma.company.findMany.mockImplementation(() =>
      Promise.resolve([
        { id: "co-1", name: "A", _count: { contacts: 2 } },
        { id: "co-2", name: "B", _count: { contacts: 0 } },
      ]),
    );
    prisma.company.count.mockImplementation(() => Promise.resolve(2));
    const res = await service.findAll("org-1");
    expect(res.data.map((c: { paidCents: number }) => c.paidCents)).toEqual([1234, 0]);
    expect(revenue.paidTotalsForCompanies).toHaveBeenCalledWith(["co-1", "co-2"], "org-1");
  });

  it("create rejects duplicate names case-insensitively with 409", async () => {
    prisma.company.findFirst.mockImplementation(() => Promise.resolve({ id: "x" }));
    try {
      await service.create({ name: "Acme" }, "org-1");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      expect((e as Error).message).toBe("A company with this name already exists");
    }
    expect(prisma.company.create).not.toHaveBeenCalled();
  });

  it("rename to another company's name is a 409", async () => {
    prisma.company.findFirst.mockImplementation(() => Promise.resolve({ id: "other" }));
    try {
      await service.update("co-1", { name: "acme" }, "org-1");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
    }
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it("update clears website and notes on null, leaves an omitted field alone", async () => {
    prisma.company.findFirst.mockImplementation(() => Promise.resolve({ id: "co-1" }));
    await service.update("co-1", { website: null, notes: null }, "org-1");
    expect(prisma.company.update).toHaveBeenLastCalledWith({
      where: { id: "co-1" },
      data: { name: undefined, website: null, notes: null },
    });
    prisma.company.findFirst.mockImplementationOnce(() => Promise.resolve({ id: "co-1" }));
    await service.update("co-1", { notes: "x" }, "org-1");
    const data = (prisma.company.update.mock.calls.at(-1) as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.website).toBeUndefined();
    expect(data.notes).toBe("x");
  });

  it("companies.remove unsets companyId on contacts", async () => {
    prisma.company.findFirst.mockImplementation(() => Promise.resolve({ id: "co-1" }));
    await service.remove("co-1", "org-1");
    expect(prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { companyId: "co-1", organizationId: "org-1" },
      data: { companyId: null },
    });
    expect(prisma.company.delete).toHaveBeenCalledWith({ where: { id: "co-1" } });
  });

  it("remove 404s for another org's company", async () => {
    try {
      await service.remove("co-x", "org-1");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundException);
    }
    expect(prisma.company.delete).not.toHaveBeenCalled();
  });
});
