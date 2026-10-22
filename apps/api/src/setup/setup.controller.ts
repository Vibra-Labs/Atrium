import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  UseGuards,
} from "@nestjs/common";
import { SetupService } from "./setup.service";
import { UpdateEmailSettingsDto, TestEmailDto } from "./setup.dto";
import {
  AuthGuard,
  RolesGuard,
  Roles,
  CurrentOrg,
} from "../common";
import { SettingsService } from "../settings/settings.service";

@Controller("setup")
@UseGuards(AuthGuard, RolesGuard)
export class SetupController {
  constructor(
    private setupService: SetupService,
    private settingsService: SettingsService,
  ) {}

  @Get("status")
  @Roles("owner", "admin")
  getSetupStatus(@CurrentOrg("id") orgId: string) {
    return this.setupService.getSetupStatus(orgId);
  }

  @Post("complete")
  @Roles("owner")
  markComplete(@CurrentOrg("id") orgId: string) {
    return this.setupService.markSetupComplete(orgId);
  }

  @Put("email")
  @Roles("owner")
  async updateEmailSettings(
    @CurrentOrg("id") orgId: string,
    @Body() dto: UpdateEmailSettingsDto,
  ) {
    const provider = dto.provider === "none" ? null : dto.provider;

    await this.settingsService.updateSettings(orgId, {
      emailProvider: provider,
      emailFrom: dto.fromEmail ?? undefined,
      resendApiKey: dto.resendApiKey ?? undefined,
      smtpHost: dto.smtpHost ?? undefined,
      smtpPort: dto.smtpPort ?? undefined,
      smtpUser: dto.smtpUser ?? undefined,
      smtpPass: dto.smtpPass ?? undefined,
      smtpSecure: dto.smtpSecure ?? undefined,
      smtpSecurity: dto.smtpSecurity ?? undefined,
    });

    return { success: true, message: "Email settings saved" };
  }

  @Post("test-email")
  @Roles("owner")
  async sendTestEmail(
    @CurrentOrg("id") orgId: string,
    @Body() dto: TestEmailDto,
  ) {
    return this.settingsService.testEmailConfig(orgId, dto.to);
  }
}
