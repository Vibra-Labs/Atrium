import {
  Controller,
  Delete,
  Get,
  Param,
  UseGuards,
} from "@nestjs/common";
import {
  AuthGuard,
  CurrentOrg,
  CurrentUser,
  Roles,
  RolesGuard,
} from "../common";
import { TwoFactorService } from "./two-factor.service";

@Controller("two-factor")
@UseGuards(AuthGuard, RolesGuard)
export class TwoFactorController {
  constructor(private service: TwoFactorService) {}

  @Get("status")
  status(
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") organizationId: string,
  ) {
    return this.service.getStatus(userId, organizationId);
  }

  @Delete("admin/:userId")
  @Roles("owner", "admin")
  disableForUser(
    @Param("userId") targetUserId: string,
    @CurrentUser("id") actorUserId: string,
    @CurrentOrg("id") organizationId: string,
  ) {
    return this.service.disableForUser(actorUserId, targetUserId, organizationId);
  }
}
