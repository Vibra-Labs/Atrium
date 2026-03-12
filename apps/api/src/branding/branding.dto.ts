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

  @IsString()
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: "Must be a valid hex color" })
  accentColor?: string;

  @IsBoolean()
  @IsOptional()
  hideLogo?: boolean;
}
