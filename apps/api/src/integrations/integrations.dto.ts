import { Transform } from "class-transformer";
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength,
} from "class-validator";
import { INTEGRATION_EVENTS, INTEGRATION_TYPES } from "@atrium/shared";
import type { IntegrationEvent, IntegrationType } from "@atrium/shared";

const trim = ({ value }: { value: unknown }): unknown => (typeof value === "string" ? value.trim() : value);

export class CreateIntegrationDto {
  @IsIn(INTEGRATION_TYPES)
  type!: IntegrationType;

  @IsString()
  @Transform(trim)
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty()
  @MaxLength(2048)
  url!: string;

  @IsArray()
  @ArrayMaxSize(INTEGRATION_EVENTS.length)
  @IsIn(INTEGRATION_EVENTS, { each: true })
  events!: IntegrationEvent[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  projectIds?: string[];
}

export class UpdateIntegrationDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @IsNotEmpty()
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(INTEGRATION_EVENTS.length)
  @IsIn(INTEGRATION_EVENTS, { each: true })
  events?: IntegrationEvent[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  projectIds?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
