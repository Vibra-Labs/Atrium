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

  async findBySlug(slug: string) {
    const org = await this.prisma.organization.findUnique({ where: { slug } });
    if (!org) throw new NotFoundException("Organization not found");

    const branding = await this.findByOrg(org.id);
    const apiUrl = this.config.get("API_URL", "http://localhost:3001");

    let logoSrc: string | null = null;
    if (branding.logoKey) {
      logoSrc = `${apiUrl}/api/branding/logo/${org.id}`;
    } else if (branding.logoUrl) {
      logoSrc = branding.logoUrl;
    }

    return {
      orgName: org.name,
      orgId: org.id,
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      logoSrc,
      hideLogo: branding.hideLogo,
    };
  }

  async findInstanceBranding() {
    const orgCount = await this.prisma.organization.count();
    if (orgCount !== 1) return null;

    const org = await this.prisma.organization.findFirst();
    if (!org) return null;

    const branding = await this.findByOrg(org.id);
    if (!branding.logoKey && !branding.logoUrl) return null;

    const apiUrl = this.config.get("API_URL", "http://localhost:3001");
    const logoSrc = branding.logoKey
      ? `${apiUrl}/api/branding/logo/${org.id}`
      : branding.logoUrl ?? null;

    return {
      orgName: org.name,
      orgId: org.id,
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      logoSrc,
      hideLogo: branding.hideLogo,
    };
  }

  async findByDomain(host: string) {
    const org = await this.prisma.organization.findFirst({ where: { customDomain: host } });
    if (!org) return null;

    const branding = await this.findByOrg(org.id);
    const apiUrl = this.config.get("API_URL", "http://localhost:3001");
    const logoSrc = branding.logoKey
      ? `${apiUrl}/api/branding/logo/${org.id}`
      : branding.logoUrl ?? null;

    return {
      orgName: org.name,
      orgId: org.id,
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      logoSrc,
      hideLogo: branding.hideLogo,
    };
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
