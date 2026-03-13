import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateBrandingDto } from "./branding.dto";

@Injectable()
export class BrandingService {
  constructor(private prisma: PrismaService) {}

  async findByOrg(organizationId: string) {
    const branding = await this.prisma.branding.findUnique({
      where: { organizationId },
    });
    if (!branding) {
      return {
        organizationId,
        primaryColor: null,
        accentColor: null,
        logoKey: null,
        logoUrl: null,
        hideLogo: false,
      };
    }
    return branding;
  }

  async findByOrgOrNull(organizationId: string) {
    return this.prisma.branding.findUnique({
      where: { organizationId },
    });
  }

  async update(organizationId: string, data: UpdateBrandingDto | { logoKey?: string | null; logoUrl?: string | null }) {
    return this.prisma.branding.upsert({
      where: { organizationId },
      update: data,
      create: {
        organizationId,
        ...data,
      },
    });
  }
}
