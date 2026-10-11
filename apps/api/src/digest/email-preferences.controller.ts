import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { IsBoolean, IsOptional } from "class-validator";
import { AuthGuard, RolesGuard, Roles, CurrentMember } from "../common";
import { EmailPreferencesService, type EmailPreferences } from "./email-preferences.service";

export class UpdateEmailPreferencesDto {
  @IsOptional()
  @IsBoolean()
  weeklyUpdateReminders?: boolean;

  @IsOptional()
  @IsBoolean()
  mondayDigest?: boolean;
}

// Owners and admins only: clients don't get these emails.
@Controller("email-preferences")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class EmailPreferencesController {
  constructor(private preferences: EmailPreferencesService) {}

  @Get()
  get(@CurrentMember("id") memberId: string): Promise<EmailPreferences> {
    return this.preferences.get(memberId);
  }

  @Put()
  update(
    @CurrentMember("id") memberId: string,
    @Body() dto: UpdateEmailPreferencesDto,
  ): Promise<EmailPreferences> {
    return this.preferences.update(memberId, dto);
  }
}
