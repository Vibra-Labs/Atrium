import { IsString, IsOptional, IsUrl, IsBoolean, Matches, ValidateIf } from "class-validator";
import { Transform } from "class-transformer";

export class UpdateBrandingDto {
  @IsOptional()
  @Transform(({ value }) => (value === "" ? undefined : value))
  @ValidateIf((o) => o.logoUrl != null)
  @IsUrl({}, { message: "Must be a valid URL" })
  logoUrl?: string | null;

  @IsString()
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: "Must be a valid hex color" })
  primaryColor?: string;

  @IsBoolean()
  @IsOptional()
  hideLogo?: boolean;

  /**
   * Removed in the release after 1.8.1 — nothing reads it. Still accepted so a
   * dashboard tab left open across the upgrade doesn't fail every branding
   * save with a 400 from forbidNonWhitelisted. Dropped by the controller and
   * never written. Delete this field one release later.
   */
  @IsString()
  @IsOptional()
  accentColor?: string;
}
