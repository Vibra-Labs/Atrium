import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { MAX_PROJECT_STATUSES } from "@atrium/shared";

const HEX = /^#[0-9a-fA-F]{6}$/;
const HEX_MESSAGE = "color must be a valid hex color (e.g. #ff0000)";

export class CreateProjectStatusDto {
  @IsString()
  @MaxLength(40)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(HEX, { message: HEX_MESSAGE })
  color?: string;
}

export class UpdateProjectStatusDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(HEX, { message: HEX_MESSAGE })
  color?: string;
}

export class ReorderProjectStatusesDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(MAX_PROJECT_STATUSES)
  ids!: string[];
}
