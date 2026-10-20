import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { paginationArgs, paginatedResponse } from "../common";
import { ContactRevenueService } from "./contact-revenue.service";
import type { CreateCompanyDto, UpdateCompanyDto } from "./contacts.dto";

const DUPLICATE_MESSAGE = "A company with this name already exists";

function requireName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new BadRequestException("Name is required");
  return name;
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: ContactRevenueService,
  ) {}

  async findAll(orgId: string, page = 1, limit = 20) {
    const where = { organizationId: orgId };
    const [companies, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        orderBy: { name: "asc" },
        include: { _count: { select: { contacts: true } } },
        ...paginationArgs(page, limit),
      }),
      this.prisma.company.count({ where }),
    ]);
    const paid = await this.revenue.paidTotalsForCompanies(
      companies.map((c) => c.id),
      orgId,
    );
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
        data: { organizationId: orgId, name, website: dto.website, notes: dto.notes },
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
        data: { name, website: dto.website, notes: dto.notes },
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
