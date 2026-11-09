import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { costSummary } from "@atrium/shared";
import type { CostSummary } from "@atrium/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CostLineDto, UpdateCostLineDto, UpdateCostsDto } from "./costs.dto";

export interface CostLine {
  id: string;
  label: string;
  amountCents: number;
}

export interface ContractCosts {
  costCents: number | null;
  laborRateCents: number | null;
  trackedSeconds: number;
  lines: CostLine[];
  summary: CostSummary;
}

const MAX_LINES = 50;

/** Cost, profit and margin on a potential contract. Stays editable after a win. */
@Injectable()
export class CostsService {
  constructor(private prisma: PrismaService) {}

  private async load(projectId: string, orgId: string) {
    const pursuit = await this.prisma.projectPursuit.findFirst({
      where: { projectId, organizationId: orgId },
      include: {
        project: { select: { archivedAt: true } },
        costLines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    });
    if (!pursuit) throw new NotFoundException("Potential contract not found");
    return pursuit;
  }

  private async assertEditable(projectId: string, orgId: string): Promise<void> {
    const pursuit = await this.load(projectId, orgId);
    if (pursuit.outcome === "lost" || pursuit.project.archivedAt) {
      throw new BadRequestException("Costs are read-only on a lost or archived contract");
    }
  }

  async get(projectId: string, orgId: string): Promise<ContractCosts> {
    const pursuit = await this.load(projectId, orgId);
    // A running timer counts once it's stopped.
    const time = await this.prisma.timeEntry.aggregate({
      _sum: { durationSec: true },
      where: { projectId, organizationId: orgId, endedAt: { not: null } },
    });
    const trackedSeconds: number = time._sum.durationSec ?? 0;
    const lines: CostLine[] = pursuit.costLines.map((l) => ({ id: l.id, label: l.label, amountCents: l.amountCents }));
    return {
      costCents: pursuit.costCents,
      laborRateCents: pursuit.laborRateCents,
      trackedSeconds,
      lines,
      summary: costSummary({
        valueCents: pursuit.valueCents,
        costCents: pursuit.costCents,
        laborRateCents: pursuit.laborRateCents,
        trackedSeconds,
        lineCents: lines.map((l) => l.amountCents),
      }),
    };
  }

  async update(projectId: string, dto: UpdateCostsDto, orgId: string): Promise<ContractCosts> {
    await this.assertEditable(projectId, orgId);
    await this.prisma.projectPursuit.update({
      where: { projectId },
      data: { costCents: dto.costCents, laborRateCents: dto.laborRateCents },
    });
    return this.get(projectId, orgId);
  }

  async addLine(projectId: string, dto: CostLineDto, orgId: string): Promise<ContractCosts> {
    await this.assertEditable(projectId, orgId);
    const count: number = await this.prisma.projectCostLine.count({ where: { projectId } });
    if (count >= MAX_LINES) throw new BadRequestException(`A contract can have up to ${MAX_LINES} cost lines`);
    // The breakdown replaces a typed cost; clear it so removing every line later doesn't bring back a stale number.
    if (count === 0) await this.prisma.projectPursuit.update({ where: { projectId }, data: { costCents: null } });
    await this.prisma.projectCostLine.create({
      data: { projectId, label: dto.label.trim(), amountCents: dto.amountCents, sortOrder: count },
    });
    return this.get(projectId, orgId);
  }

  private async lineOrThrow(projectId: string, lineId: string): Promise<void> {
    const line = await this.prisma.projectCostLine.findFirst({ where: { id: lineId, projectId } });
    if (!line) throw new NotFoundException("Cost line not found");
  }

  async updateLine(projectId: string, lineId: string, dto: UpdateCostLineDto, orgId: string): Promise<ContractCosts> {
    await this.assertEditable(projectId, orgId);
    await this.lineOrThrow(projectId, lineId);
    await this.prisma.projectCostLine.update({
      where: { id: lineId },
      data: { label: dto.label?.trim(), amountCents: dto.amountCents },
    });
    return this.get(projectId, orgId);
  }

  async removeLine(projectId: string, lineId: string, orgId: string): Promise<ContractCosts> {
    await this.assertEditable(projectId, orgId);
    await this.lineOrThrow(projectId, lineId);
    await this.prisma.projectCostLine.delete({ where: { id: lineId } });
    return this.get(projectId, orgId);
  }
}
