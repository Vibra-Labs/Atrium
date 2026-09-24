import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { UpdateClientProfileDto } from "./client-profile.dto";
import { MCP_ACTOR_ROLES, paginatedResponse, revokeMemberCredentials } from "../common";

@Injectable()
export class ClientsService {
  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
  ) {}

  async generateResetLink(
    memberId: string,
    orgId: string,
    requestingUserId: string,
    requestingRole: string,
  ): Promise<{
    url: string;
    email: string;
    emailSent: boolean;
    emailViaOrgConfig: boolean;
  }> {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, organizationId: orgId },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!member) throw new NotFoundException("Member not found");
    if (member.userId === requestingUserId) {
      throw new BadRequestException(
        "Cannot reset your own password — use forgot-password instead",
      );
    }
    if (member.role === "owner" && requestingRole !== "owner") {
      throw new ForbiddenException("Only owners can reset another owner");
    }

    const { url, emailSent, emailViaOrgConfig } =
      await this.authService.generateResetLink(member.user.email);
    return {
      url,
      email: member.user.email,
      emailSent,
      emailViaOrgConfig,
    };
  }

  async removeMember(
    memberId: string,
    orgId: string,
    requestingUserId: string,
    requestingRole: string,
  ) {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, organizationId: orgId },
    });
    if (!member) throw new NotFoundException("Member not found");
    if (member.userId === requestingUserId) {
      throw new BadRequestException("Cannot remove yourself");
    }
    if (member.role === "owner" && requestingRole !== "owner") {
      throw new BadRequestException("Only owners can remove other owners");
    }

    // Scope ProjectClient deletion to this org's projects only
    const orgProjectIds = await this.prisma.project.findMany({
      where: { organizationId: orgId },
      select: { id: true },
    });
    const projectIds = orgProjectIds.map((p) => p.id);

    await this.prisma.$transaction([
      this.prisma.projectClient.deleteMany({
        where: { userId: member.userId, projectId: { in: projectIds } },
      }),
      this.prisma.member.delete({ where: { id: memberId } }),
    ]);
  }

  async changeRole(
    memberId: string,
    newRole: string,
    orgId: string,
    requestingUserId: string,
  ) {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, organizationId: orgId },
    });
    if (!member) throw new NotFoundException("Member not found");
    if (member.userId === requestingUserId) {
      throw new BadRequestException("Cannot change your own role");
    }
    if (member.role === "owner") {
      const ownerCount = await this.prisma.member.count({
        where: { organizationId: orgId, role: "owner" },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException("Cannot demote the last owner");
      }
    }
    const validRoles = ["owner", "admin", "member"];
    if (!validRoles.includes(newRole)) {
      throw new BadRequestException("Invalid role");
    }
    if (MCP_ACTOR_ROLES.includes(newRole)) {
      return this.prisma.member.update({
        where: { id: memberId },
        data: { role: newRole },
      });
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.member.update({
        where: { id: memberId },
        data: { role: newRole },
      }),
      ...revokeMemberCredentials(this.prisma, memberId),
    ]);
    return updated;
  }

  async setMemberRate(
    memberId: string,
    orgId: string,
    actorUserId: string,
    actorRole: string,
    rate: number | null,
  ) {
    if (actorRole !== "owner") {
      throw new ForbiddenException("Only owners can set member rates");
    }
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, organizationId: orgId },
    });
    if (!member) throw new NotFoundException("Member not found");
    return this.prisma.member.update({
      where: { id: memberId },
      data: { hourlyRateCents: rate },
    });
  }

  async list(orgId: string, page = 1, limit = 20, search?: string) {
    const where = {
      organizationId: orgId,
      ...(search
        ? {
            user: {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.member.findMany({
        where,
        select: {
          id: true,
          userId: true,
          role: true,
          createdAt: true,
          hourlyRateCents: true,
          user: { select: { id: true, name: true, email: true } },
          labels: { select: { label: { select: { id: true, name: true, color: true } } } },
        },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.member.count({ where }),
    ]);

    const userIds: string[] = data.map((m) => m.userId);
    const profiles = await this.prisma.clientProfile.findMany({
      where: { userId: { in: userIds }, organizationId: orgId },
    });
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));

    const enriched = data.map((m) => ({ ...m, profile: profileMap.get(m.userId) || null }));
    return paginatedResponse(enriched, total, page, limit);
  }

  async findMember(userId: string, orgId: string) {
    const member = await this.prisma.member.findFirst({
      where: { userId, organizationId: orgId },
      select: {
        id: true, userId: true, role: true, createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    if (!member) throw new NotFoundException("Client not found");
    return member;
  }

  async getProfile(userId: string, orgId: string) {
    const profile = await this.prisma.clientProfile.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
    });
    return (
      profile || {
        userId,
        organizationId: orgId,
        company: null,
        phone: null,
        address: null,
        website: null,
        description: null,
      }
    );
  }

  async updateProfile(
    userId: string,
    orgId: string,
    dto: UpdateClientProfileDto,
  ) {
    return this.prisma.clientProfile.upsert({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      create: { userId, organizationId: orgId, ...dto },
      update: dto,
    });
  }
}
