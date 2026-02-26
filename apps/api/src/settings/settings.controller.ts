import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
} from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { UpdateSettingsDto } from "./settings.dto";
import { AuthGuard, RolesGuard, Roles, CurrentOrg, CurrentUser } from "../common";

@Controller("settings")
@UseGuards(AuthGuard, RolesGuard)
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get()
  @Roles("owner", "admin")
  getSettings(@CurrentOrg("id") orgId: string) {
    return this.settingsService.getSettings(orgId);
  }

  @Put()
  @Roles("owner")
  updateSettings(
    @CurrentOrg("id") orgId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.settingsService.updateSettings(orgId, dto);
  }

  @Post("test-email")
  @Roles("owner")
  testEmail(
    @CurrentOrg("id") orgId: string,
    @CurrentUser("email") userEmail: string,
  ) {
    return this.settingsService.testEmailConfig(orgId, userEmail);
  }
}
