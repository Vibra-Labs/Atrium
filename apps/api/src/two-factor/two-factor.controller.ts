import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentOrg, CurrentUser, Roles, RolesGuard } from "../common";
import type { AuthenticatedRequest } from "../common";
import { TwoFactorService } from "./two-factor.service";
import type { TwoFactorStatus } from "./two-factor.service";
import { SetRequirementDto } from "./two-factor.dto";

@Controller("two-factor")
@UseGuards(AuthGuard, RolesGuard)
export class TwoFactorController {
  constructor(private service: TwoFactorService) {}

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
}
