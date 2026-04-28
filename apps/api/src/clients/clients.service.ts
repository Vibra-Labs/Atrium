import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { UpdateClientProfileDto } from "./client-profile.dto";

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
  ): Promise<{ url: string; email: string }> {
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

    const url = await this.authService.generateResetLink(member.user.email);
    return { url, email: member.user.email };
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
    return this.prisma.member.update({
      where: { id: memberId },
      data: { role: newRole },
    });
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
