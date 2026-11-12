import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

export class SetRequirementDto {
  @IsBoolean()
  required!: boolean;
}

export class ResetMemberDto {
  /** The acting owner/admin's own TOTP or recovery code, when they have 2FA. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;
}
