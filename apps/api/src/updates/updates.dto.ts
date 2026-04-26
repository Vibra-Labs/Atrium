import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class CreateUpdateDto {
  @IsString()
  @MaxLength(5000)
  content: string;
}

export class UpdateContentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content: string;
}

export class PreviewPrefDto {
  @IsOptional()
  @IsIn(["compact", "full"])
  size?: "compact" | "full";

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;
}

export class UpdatePreviewPrefsDto {
  /**
   * Map of URL → { size?, hidden? }. We validate with `IsObject` only and
   * trust the service to key-by-URL — the shape is narrow enough that
   * per-URL nested validation isn't worth the class-validator gymnastics.
   */
  @IsObject()
  @ValidateNested({ each: true })
  @Type(() => PreviewPrefDto)
  previewPrefs: Record<string, PreviewPrefDto>;
}
