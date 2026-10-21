import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { requireName } from "./require-name";
import { paginationArgs, paginatedResponse } from "../common";
import { ContactRevenueService } from "./contact-revenue.service";
import { rankOrderSql } from "./contacts-sort";
import { Prisma } from "@atrium/database";
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
      // Paid totals come from invoices, so SQL ranks the matching ids and returns just this page.
      const matchIds = (await this.prisma.company.findMany({ where, select: { id: true } })).map((c) => c.id);
      const pageIds = await this.rankedByPaid(orgId, matchIds, dir, page, limit);
      const [rows, pagePaid] = await Promise.all([
        this.prisma.company.findMany({ where: { id: { in: pageIds } }, include }),
        this.revenue.paidTotalsForCompanies(pageIds, orgId),
      ]);
      const byId = new Map(rows.map((r) => [r.id, r]));
      companies = pageIds.flatMap((id) => byId.get(id) ?? []);
      total = matchIds.length;
      paid = pagePaid;
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

  /** One page of `ids` by paid total (none counts as 0), ties by name then id. */
  private async rankedByPaid(
    orgId: string,
    ids: string[],
    dir: SortDirection,
    page: number,
    limit: number,
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const paid = this.revenue.paidPerCompanySql(orgId, Prisma.sql`c."companyId" = ANY(${ids}::text[])`);
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT co.id FROM "company" co
      LEFT JOIN (${paid}) p ON p."companyId" = co.id
      WHERE co."organizationId" = ${orgId} AND co.id = ANY(${ids}::text[])
      ${rankOrderSql(Prisma.sql`COALESCE(p.paid, 0)`, dir, "co")}
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `;
    return rows.map((r) => r.id);
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
