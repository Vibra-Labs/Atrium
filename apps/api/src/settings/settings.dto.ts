import {
  IsOptional,
  IsString,
  IsEmail,
  IsInt,
  IsBoolean,
  IsIn,
  Min,
  Max,
  MaxLength,
  ValidateIf,
  Matches,
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
  @ValidateIf((_obj, value) => value !== null)
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

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  paymentInstructions?: string;

  @IsOptional()
  @IsString()
  @IsIn(["bank_transfer", "paypal", "stripe_link", "other", null], {
    message: "paymentMethod must be bank_transfer, paypal, stripe_link, other, or null",
  })
  paymentMethod?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  paymentDetails?: string;
}

export class SaveCustomDomainDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.replace(/\.$/, "").toLowerCase() : value,
  )
  @IsString()
  @MaxLength(253)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}$/, {
    message: "domain must be a valid hostname (e.g. portal.example.com)",
  })
  domain!: string;
}
