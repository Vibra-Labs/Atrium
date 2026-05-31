import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { paginationArgs, paginatedResponse } from "../common";
import type { BillingClientListQueryDto, CreateBillingClientDto, UpdateBillingClientDto } from "./billing-clients.dto";

function isP2002(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

function normalizeNullableString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class BillingClientsService {
  constructor(private prisma: PrismaService) {}

  async findAll(organizationId: string, query: BillingClientListQueryDto = {}) {
    const { page = 1, limit = 20, archived } = query;
    const where = {
      organizationId,
      ...(archived === "true" ? {} : { archivedAt: null }),
    };

    const [data, total] = await Promise.all([
      this.prisma.billingClient.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.billingClient.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  async findOne(id: string, organizationId: string) {
    const billingClient = await this.prisma.billingClient.findFirst({
      where: { id, organizationId },
      include: { projects: { select: { id: true, name: true, archivedAt: true } } },
    });
    if (!billingClient) throw new NotFoundException("Billing client not found");
    return billingClient;
  }

  async create(dto: CreateBillingClientDto, organizationId: string) {
    try {
      return await this.prisma.billingClient.create({
        data: {
          organizationId,
          name: dto.name,
          slug: normalizeNullableString(dto.slug),
          defaultHourlyRateCents: dto.defaultHourlyRateCents ?? null,
          billingPeriod: normalizeNullableString(dto.billingPeriod),
          billingNotes: normalizeNullableString(dto.billingNotes),
          externalReference: normalizeNullableString(dto.externalReference),
        },
      });
    } catch (err) {
      if (isP2002(err)) throw new ConflictException("Billing client name or slug already exists");
      throw err;
    }
  }

  async update(id: string, dto: UpdateBillingClientDto, organizationId: string) {
    const existing = await this.prisma.billingClient.findFirst({
      where: { id, organizationId },
      select: { id: true, archivedAt: true },
    });
    if (!existing) throw new NotFoundException("Billing client not found");
    if (existing.archivedAt) throw new BadRequestException("Cannot update an archived billing client");

    try {
      return await this.prisma.billingClient.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.slug !== undefined ? { slug: normalizeNullableString(dto.slug) } : {}),
          ...(dto.defaultHourlyRateCents !== undefined
            ? { defaultHourlyRateCents: dto.defaultHourlyRateCents }
            : {}),
          ...(dto.billingPeriod !== undefined ? { billingPeriod: normalizeNullableString(dto.billingPeriod) } : {}),
          ...(dto.billingNotes !== undefined ? { billingNotes: normalizeNullableString(dto.billingNotes) } : {}),
          ...(dto.externalReference !== undefined
            ? { externalReference: normalizeNullableString(dto.externalReference) }
            : {}),
        },
      });
    } catch (err) {
      if (isP2002(err)) throw new ConflictException("Billing client name or slug already exists");
      throw err;
    }
  }

  async archive(id: string, organizationId: string) {
    const existing = await this.prisma.billingClient.findFirst({
      where: { id, organizationId },
      select: { id: true, archivedAt: true },
    });
    if (!existing) throw new NotFoundException("Billing client not found");
    if (existing.archivedAt) return existing;

    return this.prisma.billingClient.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }
}
