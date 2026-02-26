import {
  IsOptional,
  IsString,
  IsEmail,
  IsInt,
  IsBoolean,
  IsIn,
  Min,
  Max,
} from "class-validator";
import { Type, Transform } from "class-transformer";

export class UpdateSettingsDto {
  @IsOptional()
  @Transform(({ value }) => (value === "" ? null : value))
  @IsIn(["resend", "smtp", null], {
    message: "emailProvider must be resend, smtp, or null",
  })
  emailProvider?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === "" ? null : value))
  @IsEmail({}, { message: "emailFrom must be a valid email address" })
  emailFrom?: string | null;

  @IsOptional()
  @IsString()
  resendApiKey?: string;

  @IsOptional()
  @IsString()
  smtpHost?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  @IsOptional()
  @IsString()
  smtpUser?: string;

  @IsOptional()
  @IsString()
  smtpPass?: string;

  @IsOptional()
  @IsBoolean()
  smtpSecure?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  maxFileSizeMb?: number;
}
