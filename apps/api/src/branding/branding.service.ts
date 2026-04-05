import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateBrandingDto } from "./branding.dto";

@Injectable()
export class BrandingService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

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

  private async buildBrandingShape(org: { id: string; name: string }, branding: Awaited<ReturnType<typeof this.findByOrg>>) {
    const apiUrl = this.config.get("API_URL", "http://localhost:3001");
    const logoSrc = branding.logoKey
      ? `${apiUrl}/api/branding/logo/${org.id}`
      : branding.logoUrl ?? null;
    return { orgName: org.name, orgId: org.id, primaryColor: branding.primaryColor, accentColor: branding.accentColor, logoSrc, hideLogo: branding.hideLogo };
  }

  async findBySlug(slug: string) {
    const org = await this.prisma.organization.findUnique({ where: { slug } });
    if (!org) throw new NotFoundException("Organization not found");
    const branding = await this.findByOrg(org.id);
    return this.buildBrandingShape(org, branding);
  }

  async findInstanceBranding() {
    // Take 2 so we can determine "exactly one org" in a single query
    const orgs = await this.prisma.organization.findMany({ take: 2 });
    if (orgs.length !== 1) return null;

    const org = orgs[0];
    const branding = await this.findByOrg(org.id);
    if (!branding.logoKey && !branding.logoUrl) return null;

    return this.buildBrandingShape(org, branding);
  }

  async findByDomain(host: string) {
    const org = await this.prisma.organization.findUnique({ where: { customDomain: host } });
    if (!org) return null;
    const branding = await this.findByOrg(org.id);
    return this.buildBrandingShape(org, branding);
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
