import { describe, expect, it, mock, beforeEach } from "bun:test";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { CompaniesService } from "./companies.service";
import type { ContactRevenueService } from "./contact-revenue.service";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { ListCompaniesQueryDto, UpdateCompanyDto } from "./contacts.dto";

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

  it("findAll sorts by name or people count in the database", async () => {
    const orderByOf = (): unknown =>
      (prisma.company.findMany.mock.calls.at(-1)?.[0] as { orderBy: unknown }).orderBy;
    await service.findAll("org-1");
    expect(orderByOf()).toEqual([{ name: "asc" }, { id: "asc" }]);
    await service.findAll("org-1", 1, 20, undefined, "name", "desc");
    expect(orderByOf()).toEqual([{ name: "desc" }, { id: "asc" }]);
    await service.findAll("org-1", 1, 20, undefined, "people", "desc");
    expect(orderByOf()).toEqual([{ contacts: { _count: "desc" } }, { name: "asc" }, { id: "asc" }]);
  });

  it("findAll sorts by paid total across every page", async () => {
    prisma.company.findMany.mockImplementation((args: unknown) => {
      const a = args as { select?: unknown; where: { id?: { in: string[] } } };
      if (a.select) {
        return Promise.resolve([
          { id: "co-1", name: "Acme" },
          { id: "co-2", name: "Beta" },
          { id: "co-3", name: "Cove" },
        ]);
      }
      const ids = a.where.id?.in ?? [];
      return Promise.resolve(ids.map((id) => ({ id, name: id, _count: { contacts: 0 } })));
    });
    revenue.paidTotalsForCompanies.mockImplementation(() =>
      Promise.resolve(new Map([["co-3", 99], ["co-1", 10]])),
    );
    const res = await service.findAll("org-1", 1, 2, undefined, "paid", "desc");
    expect(revenue.paidTotalsForCompanies).toHaveBeenLastCalledWith(null, "org-1");
    expect(res.data.map((c: { id: string }) => c.id)).toEqual(["co-3", "co-1"]);
    expect(res.data.map((c: { paidCents: number }) => c.paidCents)).toEqual([99, 10]);
    prisma.company.findMany.mockImplementation(() => Promise.resolve([]));
    revenue.paidTotalsForCompanies.mockImplementation(() => Promise.resolve(new Map([["co-1", 1234]])));
  });

  it("ListCompaniesQueryDto accepts only known sorts", async () => {
    expect(await validate(plainToInstance(ListCompaniesQueryDto, { sort: "people", dir: "asc" }))).toHaveLength(0);
    expect(await validate(plainToInstance(ListCompaniesQueryDto, { sort: "website" }))).not.toHaveLength(0);
  });

  it("findAll filters by name case-insensitively when searching", async () => {
    prisma.company.findMany.mockClear();
    prisma.company.count.mockClear();
    await service.findAll("org-1", 1, 20, " Acme ");
    const where = { organizationId: "org-1", name: { contains: "Acme", mode: "insensitive" } };
    expect(prisma.company.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(prisma.company.count).toHaveBeenCalledWith({ where });
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

  it("create and rename reject blank or whitespace-only names with 400", async () => {
    for (const name of ["", "   "]) {
      await expect(service.create({ name }, "org-1")).rejects.toBeInstanceOf(BadRequestException);
      prisma.company.findFirst.mockImplementationOnce(() => Promise.resolve({ id: "co-1" }));
      await expect(service.update("co-1", { name }, "org-1")).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(prisma.company.update).not.toHaveBeenCalled();
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
      data: { name: undefined, website: null, notes: null, annualRevenue: undefined, employeeCount: undefined },
    });
    prisma.company.findFirst.mockImplementationOnce(() => Promise.resolve({ id: "co-1" }));
    await service.update("co-1", { notes: "x" }, "org-1");
    const data = (prisma.company.update.mock.calls.at(-1) as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.website).toBeUndefined();
    expect(data.notes).toBe("x");
  });

  it("update sets and clears annual revenue and employee count", async () => {
    prisma.company.findFirst.mockImplementation(() => Promise.resolve({ id: "co-1" }));
    await service.update("co-1", { annualRevenue: 1_500_000, employeeCount: 12 }, "org-1");
    let data = (prisma.company.update.mock.calls.at(-1) as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({ annualRevenue: 1_500_000, employeeCount: 12 });

    await service.update("co-1", { annualRevenue: null, employeeCount: null }, "org-1");
    data = (prisma.company.update.mock.calls.at(-1) as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({ annualRevenue: null, employeeCount: null });
  });

  it("create stores annual revenue and employee count", async () => {
    await service.create({ name: "Acme", annualRevenue: 10, employeeCount: 0 }, "org-1");
    expect(prisma.company.create).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        name: "Acme",
        website: undefined,
        notes: undefined,
        annualRevenue: 10,
        employeeCount: 0,
      },
    });
  });

  it("UpdateCompanyDto: whole numbers 0..2,000,000,000 or null", async () => {
    const ok = (body: object): Promise<number> =>
      validate(plainToInstance(UpdateCompanyDto, body)).then((errors) => errors.length);
    expect(await ok({ annualRevenue: 0, employeeCount: 2_000_000_000 })).toBe(0);
    expect(await ok({ annualRevenue: null, employeeCount: null })).toBe(0);
    expect(await ok({ annualRevenue: -1 })).toBe(1);
    expect(await ok({ employeeCount: 1.5 })).toBe(1);
    expect(await ok({ annualRevenue: 2_000_000_001 })).toBe(1);
    expect(await ok({ employeeCount: "12" })).toBe(1);
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
