import {
  Controller,
  Get,
  Delete,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import {
  AuthGuard,
  RolesGuard,
  Roles,
  CurrentOrg,
  CurrentUser,
  CurrentMember,
  PaginationQueryDto,
  paginatedResponse,
} from "../common";
import { ClientsService } from "./clients.service";
import { ChangeRoleDto } from "./clients.dto";
import { UpdateClientProfileDto } from "./client-profile.dto";

@Controller("clients")
@UseGuards(AuthGuard, RolesGuard)
export class ClientsController {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private clientsService: ClientsService,
  ) {}

  @Get()
  @Roles("owner", "admin")
  async list(
    @CurrentOrg("id") orgId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const { page = 1, limit = 20 } = query;
    const where = { organizationId: orgId };
    const [data, total] = await Promise.all([
      this.prisma.member.findMany({
        where,
        select: {
          id: true,
          userId: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
          labels: { select: { label: { select: { id: true, name: true, color: true } } } },
        },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.member.count({ where }),
    ]);

    const userIds = data.map((m) => m.userId);
    const profiles = await this.prisma.clientProfile.findMany({
      where: { userId: { in: userIds }, organizationId: orgId },
    });
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));

    const enriched = data.map((m) => ({
      ...m,
      profile: profileMap.get(m.userId) || null,
    }));

    return paginatedResponse(enriched, total, page, limit);
  }

  @Get("invitations")
  @Roles("owner", "admin")
  async invitations(@CurrentOrg("id") orgId: string) {
    const webUrl = this.config.get("WEB_URL", "http://localhost:3000");
    const invitations = await this.prisma.invitation.findMany({
      where: { organizationId: orgId, status: "pending" },
      orderBy: { createdAt: "desc" },
    });
    return invitations.map((inv) => ({
      ...inv,
      inviteLink: `${webUrl}/accept-invite?id=${inv.id}`,
    }));
  }

  @Get("me/profile")
  async getMyProfile(
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.clientsService.getProfile(userId, orgId);
  }

  @Put("me/profile")
  async updateMyProfile(
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @Body() dto: UpdateClientProfileDto,
  ) {
    return this.clientsService.updateProfile(userId, orgId, dto);
  }

  @Get(":id/profile")
  @Roles("owner", "admin")
  async getClientProfile(
    @Param("id") userId: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.clientsService.getProfile(userId, orgId);
  }

  @Put(":id/profile")
  @Roles("owner", "admin")
  async updateClientProfile(
    @Param("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @Body() dto: UpdateClientProfileDto,
  ) {
    return this.clientsService.updateProfile(userId, orgId, dto);
  }

  @Delete(":id")
  @Roles("owner", "admin")
  async remove(
    @Param("id") memberId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
  ) {
    await this.clientsService.removeMember(memberId, orgId, userId, role);
  }

  @Put(":id/role")
  @Roles("owner")
  async changeRole(
    @Param("id") memberId: string,
    @Body() dto: ChangeRoleDto,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.clientsService.changeRole(memberId, dto.role, orgId, userId);
  }
}
