import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Actor } from "../common";

const GRANT_ROLES: string[] = ["owner", "admin"];

export type ResolvedOAuthToken = Actor & { oauthClientId: string };

export interface GrantSummary {
  id: string;
  clientName: string;
  organizationName: string;
  userName: string;
  createdAt: Date;
  mine: boolean;
}

@Injectable()
export class McpAuthService {
  constructor(private prisma: PrismaService) {}

  /** OAuth access token → actor. Same role rule as API keys; expiry is checked here
   * because the OAuth plugin's own token lookup does not check it. */
  async resolve(token: string): Promise<ResolvedOAuthToken | null> {
    const row = await this.prisma.oauthAccessToken.findUnique({ where: { accessToken: token } });
    if (!row || !row.userId) return null;
    if (row.accessTokenExpiresAt.getTime() <= Date.now()) return null;

    const grant = await this.prisma.mcpGrant.findUnique({
      where: { userId_clientId: { userId: row.userId, clientId: row.clientId } },
      include: { user: true, organization: true },
    });
    if (!grant) return null;

    const member = await this.prisma.member.findFirst({
      where: { userId: row.userId, organizationId: grant.organizationId },
    });
    if (!member || !GRANT_ROLES.includes(member.role)) return null;

    return { user: grant.user, organization: grant.organization, member, oauthClientId: row.clientId };
  }

  async getClient(clientId: string): Promise<{ clientId: string; name: string; icon: string | null }> {
    const app = await this.prisma.oauthApplication.findUnique({
      where: { clientId },
      select: { clientId: true, name: true, icon: true },
    });
    if (!app) throw new NotFoundException("Unknown application");
    return app;
  }

  async adminOrganizations(userId: string): Promise<{ id: string; name: string }[]> {
    const memberships = await this.prisma.member.findMany({
      where: { userId, role: { in: GRANT_ROLES } },
      select: { organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return memberships.map((m) => m.organization);
  }

  async saveGrant(userId: string, clientId: string, organizationId: string): Promise<void> {
    const member = await this.prisma.member.findFirst({ where: { userId, organizationId } });
    if (!member || !GRANT_ROLES.includes(member.role)) {
      throw new ForbiddenException("You must be an owner or admin of that workspace");
    }
    await this.getClient(clientId);
    await this.prisma.mcpGrant.upsert({
      where: { userId_clientId: { userId, clientId } },
      create: { userId, clientId, organizationId },
      update: { organizationId },
    });
  }

  /** Admins see their own grants in this workspace; the owner sees everyone's. */
  async listGrants(userId: string, organizationId: string, role: string): Promise<GrantSummary[]> {
    const grants = await this.prisma.mcpGrant.findMany({
      where: { organizationId, ...(role === "owner" ? {} : { userId }) },
      include: { user: { select: { name: true } }, organization: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    const apps = await this.prisma.oauthApplication.findMany({
      where: { clientId: { in: grants.map((g) => g.clientId) } },
      select: { clientId: true, name: true },
    });
    const names = new Map(apps.map((a) => [a.clientId, a.name]));
    return grants.map((g) => ({
      id: g.id,
      clientName: names.get(g.clientId) ?? "Unknown app",
      organizationName: g.organization.name,
      userName: g.user.name,
      createdAt: g.createdAt,
      mine: g.userId === userId,
    }));
  }

  async revokeGrant(id: string, userId: string, organizationId: string, role: string): Promise<void> {
    const grant = await this.prisma.mcpGrant.findFirst({ where: { id, organizationId } });
    if (!grant) throw new NotFoundException("Connected app not found");
    if (grant.userId !== userId && role !== "owner") {
      throw new ForbiddenException("Only the workspace owner can disconnect another person's app");
    }
    const scope = { userId: grant.userId, clientId: grant.clientId };
    await this.prisma.$transaction([
      this.prisma.oauthAccessToken.deleteMany({ where: scope }),
      this.prisma.oauthConsent.deleteMany({ where: scope }),
      this.prisma.mcpGrant.delete({ where: { id: grant.id } }),
    ]);
  }
}
