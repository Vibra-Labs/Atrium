import {
  Controller,
  Get,
  Delete,
  Post,
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
} from "../common";
import { ClientsService } from "./clients.service";
import { presentInvitations } from "./invitations";
import { ChangeRoleDto, SetRateDto } from "./clients.dto";
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
    return this.clientsService.list(orgId, query.page, query.limit);
  }

  @Get("invitations")
  @Roles("owner", "admin")
  async invitations(@CurrentOrg("id") orgId: string) {
    const webUrl = this.config.get("WEB_URL", "http://localhost:3000");
    const invitations = await this.prisma.invitation.findMany({
      where: { organizationId: orgId, status: "pending" },
      orderBy: { createdAt: "desc" },
    });
    return presentInvitations(invitations, webUrl, new Date());
  }

  // The caller's own profile (portal settings). Stored on their contact; only these five fields.
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

  @Post(":id/reset-password")
  @Roles("owner", "admin")
  async resetPassword(
    @Param("id") memberId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
  ) {
    return this.clientsService.generateResetLink(
      memberId,
      orgId,
      userId,
      role,
    );
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

  @Put(":id/rate")
  @Roles("owner")
  async setRate(
    @Param("id") memberId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
    @CurrentMember("role") role: string,
    @Body() dto: SetRateDto,
  ) {
    return this.clientsService.setMemberRate(
      memberId,
      orgId,
      userId,
      role,
      dto.hourlyRateCents ?? null,
    );
  }
}
