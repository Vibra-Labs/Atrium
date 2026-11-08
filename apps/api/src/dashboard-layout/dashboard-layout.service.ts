import { Injectable } from "@nestjs/common";
import { DASHBOARD_WIDGET_KEYS, type DashboardWidget } from "@atrium/shared";
import { PrismaService } from "../prisma/prisma.service";

export interface DashboardLayout {
  hidden: DashboardWidget[];
}

const SELECT = { dashboardHidden: true } as const;

function known(keys: string[]): DashboardWidget[] {
  return [...new Set(keys)].filter((k): k is DashboardWidget => (DASHBOARD_WIDGET_KEYS as string[]).includes(k));
}

/** Per-member choice of which dashboard cards to hide. */
@Injectable()
export class DashboardLayoutService {
  constructor(private prisma: PrismaService) {}

  async get(memberId: string): Promise<DashboardLayout> {
    const row = await this.prisma.member.findUniqueOrThrow({ where: { id: memberId }, select: SELECT });
    return { hidden: known(row.dashboardHidden) };
  }

  async update(memberId: string, hidden: string[]): Promise<DashboardLayout> {
    const row = await this.prisma.member.update({
      where: { id: memberId },
      data: { dashboardHidden: known(hidden) },
      select: SELECT,
    });
    return { hidden: known(row.dashboardHidden) };
  }
}
