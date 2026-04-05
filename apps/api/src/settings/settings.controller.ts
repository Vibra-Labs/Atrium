import {
  Controller,
  Get,
  Put,
  Patch,
  Post,
  Delete,
  Body,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SettingsService } from "./settings.service";
import { BillingService } from "../billing/billing.service";
import { UpdateSettingsDto, SaveCustomDomainDto } from "./settings.dto";
import { AuthGuard, RolesGuard, Roles, CurrentOrg, CurrentUser } from "../common";

@Controller("settings")
@UseGuards(AuthGuard, RolesGuard)
export class SettingsController {
  constructor(
    private settingsService: SettingsService,
    private billingService: BillingService,
    private config: ConfigService,
  ) {}

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

  @Patch()
  @Roles("owner")
  patchSettings(
    @CurrentOrg("id") orgId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.settingsService.updateSettings(orgId, dto);
  }

  // No @Roles — intentionally accessible to all authenticated users including clients
  @Get("payment-instructions")
  getPaymentInstructions(@CurrentOrg("id") orgId: string) {
    return this.settingsService.getPaymentInstructions(orgId);
  }

  @Post("test-email")
  @Roles("owner")
  testEmail(
    @CurrentOrg("id") orgId: string,
    @CurrentUser("email") userEmail: string,
  ) {
    return this.settingsService.testEmailConfig(orgId, userEmail);
  }

  @Get("custom-domain")
  @Roles("owner")
  getCustomDomain(@CurrentOrg("id") orgId: string) {
    return this.settingsService.getCustomDomain(orgId);
  }

  @Put("custom-domain")
  @Roles("owner")
  async saveCustomDomain(
    @CurrentOrg("id") orgId: string,
    @Body() dto: SaveCustomDomainDto,
  ) {
    const billingEnabled = this.config.get("BILLING_ENABLED") === "true";
    if (billingEnabled) {
      const sub = await this.billingService.getSubscription(orgId);
      if (!sub || sub.plan.slug === "free") {
        throw new ForbiddenException("Custom domains require a paid plan.");
      }
    }
    return this.settingsService.saveCustomDomain(orgId, dto.domain);
  }

  @Delete("custom-domain")
  @Roles("owner")
  removeCustomDomain(@CurrentOrg("id") orgId: string) {
    return this.settingsService.removeCustomDomain(orgId);
  }

  @Get("custom-domain/verify")
  @Roles("owner")
  verifyCustomDomain(@CurrentOrg("id") orgId: string) {
    return this.settingsService.verifyCustomDomain(orgId);
  }
}
