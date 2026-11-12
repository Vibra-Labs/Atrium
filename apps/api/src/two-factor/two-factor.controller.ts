import { Body, Controller, Delete, Get, Param, Put, Req, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthGuard, CurrentOrg, CurrentUser, Roles, RolesGuard } from "../common";
import type { AuthenticatedRequest } from "../common";
import { TwoFactorService } from "./two-factor.service";
import type { TwoFactorStatus } from "./two-factor.service";
import { ResetMemberDto, SetRequirementDto } from "./two-factor.dto";

@Controller("two-factor")
@UseGuards(AuthGuard, RolesGuard)
export class TwoFactorController {
  constructor(
    private service: TwoFactorService,
    private config: ConfigService,
  ) {}

  /** Open to pending sessions and owed enrollment too (see second-factor.ts), so the web app can route them. */
  @Get("status")
  status(@Req() req: AuthenticatedRequest): Promise<TwoFactorStatus> {
    return this.service.getStatus({
      userId: req.user.id,
      secondFactor: req.session.secondFactor ?? null,
      organizationId: req.organization?.id,
      role: req.member?.role,
    });
  }

  @Put("requirement")
  @Roles("owner")
  setRequirement(
    @Body() body: SetRequirementDto,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") organizationId: string,
  ): Promise<{ required: boolean }> {
    return this.service.setRequirement(userId, organizationId, body.required);
  }

  @Delete("admin/:userId")
  @Roles("owner", "admin")
  resetForMember(
    @Param("userId") targetUserId: string,
    @Body() body: ResetMemberDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: true }> {
    const headers: Headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value[0] : value);
    }
    return this.service.resetForMember({
      actorId: req.user.id,
      actorRole: req.member.role,
      organizationId: req.organization.id,
      targetUserId,
      code: body.code,
      headers,
      hosted: this.config.get("BILLING_ENABLED") === "true",
      session: req.session,
    });
  }
}
