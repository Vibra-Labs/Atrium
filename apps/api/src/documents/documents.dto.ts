import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsOptional,
  MaxLength,
  IsBoolean,
  IsInt,
  IsNumber,
  IsArray,
  Min,
  Max,
  ValidateNested,
} from "class-validator";
import { Transform, Type } from "class-transformer";

export class CreateDocumentDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsIn(["quote", "contract", "proposal", "nda", "other"])
  type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === "true" || value === true)
  requiresSignature?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === "true" || value === true)
  requiresApproval?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  options?: string; // comma-separated choices

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === "true" || value === true)
  signingOrderEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  @Transform(({ value }) => value != null ? parseInt(value, 10) : undefined)
  expiresInDays?: number;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === "true" || value === true)
  reminderEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  @Transform(({ value }) => value != null ? parseInt(value, 10) : undefined)
  reminderIntervalDays?: number;
}

export class RespondDocumentDto {
  @IsString()
  @IsIn(["accepted", "declined"])
  action!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SendDocumentDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

export class UploadVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class VoidDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CreateSignatureFieldDto {
  @IsInt()
  @Min(0)
  pageNumber!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  x!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  y!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  width!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  height!: number;

  @IsOptional()
  @IsString()
  @IsIn(["signature", "date", "initials", "text", "select"])
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  signerOrder?: number;

  @IsOptional()
  @IsString()
  assignedTo?: string;
}

export class SetSignatureFieldsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSignatureFieldDto)
  fields!: CreateSignatureFieldDto[];
}

export class SignDocumentDto {
  @IsString()
  @IsIn(["draw", "type"])
  method!: string;

  @IsString()
  @IsNotEmpty()
  fieldId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  textValue?: string;
}
