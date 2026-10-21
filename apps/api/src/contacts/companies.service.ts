import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { requireName } from "./require-name";
import { paginationArgs, paginatedResponse } from "../common";
import { ContactRevenueService } from "./contact-revenue.service";
import { rankRows } from "./contacts-sort";
import type { Prisma } from "@atrium/database";
import type { CompanySort, CreateCompanyDto, SortDirection, UpdateCompanyDto } from "./contacts.dto";

const DUPLICATE_MESSAGE = "A company with this name already exists";

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: ContactRevenueService,
  ) {}

  async findAll(
    orgId: string,
    page = 1,
    limit = 20,
    search?: string,
    sort: CompanySort = "name",
    dir: SortDirection = sort === "paid" ? "desc" : "asc",
  ) {
    const term = search?.trim();
    const where = {
      organizationId: orgId,
      ...(term ? { name: { contains: term, mode: "insensitive" as const } } : {}),
    };
    const include = { _count: { select: { contacts: true } } } as const;

    let companies;
    let total: number;
    let paid: Map<string, number>;
    if (sort === "paid") {
      // Paid totals come from invoices, so rank every match here and fetch only this page.
      const [matches, allPaid] = await Promise.all([
        this.prisma.company.findMany({ where, select: { id: true, name: true } }),
        this.revenue.paidTotalsForCompanies(null, orgId),
      ]);
      const pageIds = rankRows(matches, dir, (c) => allPaid.get(c.id) ?? 0).slice((page - 1) * limit, page * limit);
      const rows = await this.prisma.company.findMany({ where: { id: { in: pageIds } }, include });
      const byId = new Map(rows.map((r) => [r.id, r]));
      companies = pageIds.flatMap((id) => byId.get(id) ?? []);
      total = matches.length;
      paid = allPaid;
    } else {
      const orderBy: Prisma.CompanyOrderByWithRelationInput[] =
        sort === "people"
          ? [{ contacts: { _count: dir } }, { name: "asc" }, { id: "asc" }]
          : [{ name: dir }, { id: "asc" }];
      [companies, total] = await Promise.all([
        this.prisma.company.findMany({ where, orderBy, include, ...paginationArgs(page, limit) }),
        this.prisma.company.count({ where }),
      ]);
      paid = await this.revenue.paidTotalsForCompanies(
        companies.map((c) => c.id),
        orgId,
      );
    }
    const data = companies.map((c) => ({ ...c, paidCents: paid.get(c.id) ?? 0 }));
    return paginatedResponse(data, total, page, limit);
  }

  async findOne(id: string, orgId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, organizationId: orgId },
      include: {
        contacts: {
          orderBy: { name: "asc" },
          select: { id: true, name: true, email: true, status: true },
        },
      },
    });
    if (!company) throw new NotFoundException("Company not found");
    const { contacts, ...rest } = company;
    return {
      ...rest,
      people: contacts,
      revenue: await this.revenue.forCompany(id, orgId, new Date()),
    };
  }

  async create(dto: CreateCompanyDto, orgId: string) {
    const name = requireName(dto.name);
    await this.assertNameFree(name, orgId);
    try {
      return await this.prisma.company.create({
        data: {
          organizationId: orgId,
          name,
          website: dto.website,
          notes: dto.notes,
          annualRevenue: dto.annualRevenue,
          employeeCount: dto.employeeCount,
        },
      });
    } catch (e) {
      throw this.mapDuplicate(e);
    }
  }

  async update(id: string, dto: UpdateCompanyDto, orgId: string) {
    await this.getOrThrow(id, orgId);
    const name = dto.name === undefined ? undefined : requireName(dto.name);
    if (name) await this.assertNameFree(name, orgId, id);
    try {
      return await this.prisma.company.update({
        where: { id },
        data: {
          name,
          website: dto.website,
          notes: dto.notes,
          annualRevenue: dto.annualRevenue,
          employeeCount: dto.employeeCount,
        },
      });
    } catch (e) {
      throw this.mapDuplicate(e);
    }
  }

  async remove(id: string, orgId: string): Promise<void> {
    await this.getOrThrow(id, orgId);
    await this.prisma.$transaction([
      this.prisma.contact.updateMany({
        where: { companyId: id, organizationId: orgId },
        data: { companyId: null },
      }),
      this.prisma.company.delete({ where: { id } }),
    ]);
  }

  private async getOrThrow(id: string, orgId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!company) throw new NotFoundException("Company not found");
    return company;
  }

  private async assertNameFree(name: string, orgId: string, selfId?: string): Promise<void> {
    const existing = await this.prisma.company.findFirst({
      where: {
        organizationId: orgId,
        name: { equals: name, mode: "insensitive" },
        ...(selfId ? { id: { not: selfId } } : {}),
      },
    });
    if (existing) throw new ConflictException(DUPLICATE_MESSAGE);
  }

  private mapDuplicate(e: unknown): unknown {
    return (e as { code?: string })?.code === "P2002" ? new ConflictException(DUPLICATE_MESSAGE) : e;
  }
}
